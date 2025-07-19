import { formatDate, truncate } from "@/shared/utils";
import { Argv, Bot, Context, Driver, Element, h, Logger, Query, Random, Service, Session } from "koishi";
import { randomUUID } from "node:crypto";
import { ChannelDescriptor } from "../../agent";
import { IChatModel, TaskType } from "../model";
import { PromptService } from "../prompt";
import { Services, TableName } from "../types";
import { AgentResponse } from "./agent-response-types";
import { HistoryConfig } from "./config";
import { DialogueSegmentData, MemberData, MessageData, SystemEventData } from "./database-models";
import { CommandInvocationPayload } from "./event-types";
import {
    AgentTurn,
    Channel,
    ClosedDialogueSegment,
    ContextualMessage,
    DialogueSegment,
    FoldedDialogueSegment,
    GuildMember,
    History,
    SummarizedDialogueSegment,
    WorldState,
} from "./interfaces";

// 扩展 Koishi 的 Context 和 Events 接口
declare module "koishi" {
    interface Context {
        [Services.WorldState]: WorldStateService;
    }
    interface Events {
        /**
         * 当一个对话片段（DialogueSegment）的内容或状态发生更新时触发。
         * 这通常发生在记录了新消息、新事件或 Agent 回合之后。
         * @param session 触发更新的会话对象
         * @param sid 更新后的对话片段的ID
         */
        "worldstate:segment-updated"(session: Session, sid: string): void;

        /**
         * 当需要进行对话总结时触发
         */
        "worldstate:summary"(foldedSegments: DialogueSegmentData[]): void;
    }
}

/**
 * 对话片段的状态枚举，用于替代魔法字符串，提高代码健壮性。
 */
enum SegmentStatus {
    Open = "open",
    Closed = "closed",
    Folded = "folded",
    Summarized = "summarized",
    Archived = "archived",
}

/**
 * 用于追踪已被调用但尚未产生结果的指令。
 * 这是为了解决 `session.scope` 不唯一带来的竞态问题。
 */
interface PendingCommand {
    /** 在数据库中要更新的事件ID (e.g., `cmd_invoked_...`) */
    commandEventId: string;
    /** 用于匹配的指令作用域符号 */
    scope: string;
    /** 调用者的用户ID，用于更精确的匹配 */
    invokerId: string;
    /** 创建时间戳，用于清理过期的待定项 */
    timestamp: number;
}

/**
 * ## WorldStateService
 *
 * 核心职责:
 * 1.  **事件监听与记录**: 监听并记录所有相关的交互事件，包括用户消息、指令调用、AI 回复和操作员消息。
 * 2.  **对话组织**: 将离散的事件流组织成结构化的“对话片段”(DialogueSegments)。
 * 3.  **生命周期管理**: 管理对话片段的生命周期，从 `open` 到 `closed`，再到 `folded`、`summarized` 和 `archived`。
 * 4.  **上下文供给**: 为 Agent 提供一个干净、完整、且经过策略压缩的上下文视图 (`WorldState`)。
 * 5.  **后台维护**: 执行周期性任务，如自动总结旧对话和清理过期数据。
 */
export class WorldStateService extends Service<HistoryConfig> {
    // =================================================================================
    // #region 静态属性与依赖注入
    // =================================================================================

    static readonly inject = [Services.Model, Services.Image, Services.Logger, Services.Prompt];

    // #endregion

    // =================================================================================
    // #region 实例属性
    // =================================================================================

    /** 服务专用日志记录器 */
    private readonly _logger: Logger;

    /** 用于生成对话总结的聊天模型 */
    private chatModel: IChatModel;

    /** 事件监听器清理函数集合 */
    private readonly disposers: (() => boolean)[] = [];

    /** 后台维护任务定时器 */
    private maintenanceTimer: NodeJS.Timeout;

    private readonly promptService: PromptService;

    /**
     * 待处理指令的内存状态机
     * Key: 频道ID (session.channelId)
     * Value: 该频道内所有待处理指令的数组
     */
    private readonly pendingCommands = new Map<string, PendingCommand[]>();

    /**
     * 正在处理总结的频道集合
     */
    private summarizingChannels: Set<string> = new Set();

    // #endregion

    // =================================================================================
    // #region 生命周期方法
    // =================================================================================

    constructor(ctx: Context, config: HistoryConfig) {
        super(ctx, Services.WorldState, true);
        this.ctx = ctx;
        this.config = config;
        this._logger = ctx[Services.Logger].getLogger("[世界状态]");

        this.promptService = this.ctx[Services.Prompt];

        // 注册总结模板
        this.registerSummarizationTemplate();
    }

    /**
     * 注册总结相关的模板
     */
    private registerSummarizationTemplate(): void {
        this.promptService.registerTemplate("worldstate.summarization", this.config.summarizationPrompt);

        // 注册总结相关的片段
        this.promptService.registerSnippet("aiIdentity", (context) => context.aiIdentity);

        this.promptService.registerSnippet(
            "previousSummary",
            (context) => context.previousSummary || "无（这是第一次总结)"
        );

        this.promptService.registerSnippet("newMessages", (context) => context.newMessages);
    }

    /**
     * 服务启动时调用，负责注册数据库模型、监听事件和启动定时任务。
     */
    protected start(): void {
        this.chatModel = this.ctx[Services.Model].useChatGroup(TaskType.Summarization)?.current;
        if (!this.chatModel) {
            this._logger.warn("未找到任何可用的总结模型，自动总结功能将不可用。");
        }

        this.registerDatabaseModels();
        this.registerEventListeners();
        this.registerCommands();

        this.maintenanceTimer = setInterval(() => {
            this.runMaintenanceTasks();
        }, this.config.advanced.cleanupIntervalMs);

        this._logger.info("服务已启动");
    }

    /**
     * 服务停止时调用，负责清理所有监听器和定时器。
     */
    protected stop(): void {
        this.disposers.forEach((dispose) => dispose());
        this.disposers.length = 0;
        if (this.maintenanceTimer) {
            clearInterval(this.maintenanceTimer);
        }
        this._logger.info("服务已停止");
    }

    // #endregion

    // =================================================================================
    // #region 公共 API
    // =================================================================================

    /**
     * 获取指定频道集合的完整世界状态，供 Agent 使用。
     * 此方法是服务对外的核心接口，整合了所有上下文信息并应用了压缩策略。
     *
     * @param session 当前会话对象，用于确定上下文的中心频道。
     * @param onetimeCode 一个一次性代码，用于在 `h.transform` 中进行特定处理，以确保资源安全。
     * @returns 一个包含目标频道完整上下文的 `WorldState` 对象。
     */
    public async getWorldState(session: Session): Promise<WorldState> {
        const worldState: WorldState = {
            channel: await this.buildFullContextForChannel({ platform: session.platform, id: session.channelId }),
        };

        return pruneHistoryByMessages(worldState, this.config.advanced.maxMessages);
    }

    /**
     * 记录一个 Agent 回合的完整响应，并关闭当前开放的对话片段。
     * 这标志着一个交互周期（从用户输入到 Agent 响应）的结束。
     *
     * @param sid 目标对话片段的 ID。
     * @param responses Agent 生成的响应对象列表。
     */
    public async recordAgentTurn(sid: string, responses: AgentResponse[]): Promise<void> {
        const agentTurn: AgentTurn = {
            responses,
            timestamp: new Date(),
        };

        await this.ctx.database.set(
            TableName.DialogueSegments,
            { id: sid },
            { status: SegmentStatus.Closed, agentTurn }
        );
        this._logger.debug(`片段已关闭 | ID: ${sid} | 响应数: ${responses.length}`);

        const segmentRecord = await this.ctx.database
            .get(TableName.DialogueSegments, { id: sid })
            .then((res) => res[0]);
        if (segmentRecord) {
            await this.applyFoldingPolicy(segmentRecord.platform, segmentRecord.channelId);
        }
    }

    /**
     * 获取指定频道的当前开放对话片段。如果不存在，则创建一个新的。
     *
     * @param platform 平台名称 (e.g., 'onebot', 'discord')。
     * @param channelId 频道 ID。
     * @param guildId 服务器（群组）ID，可选。
     * @returns 当前开放的对话片段的数据库记录。
     */
    public async getOpenSegment(platform: string, channelId: string, guildId?: string): Promise<DialogueSegmentData> {
        const openSegments = await this.ctx.database
            .select(TableName.DialogueSegments)
            .where({ platform, channelId, status: SegmentStatus.Open })
            .orderBy("timestamp", "desc")
            .execute();

        if (openSegments.length > 0) {
            const currentSegment = openSegments.shift();
            // 如果存在多个开放片段，这是一个异常状态，需要修复。关闭所有旧的。
            if (openSegments.length > 0) {
                const oldSegmentIds = openSegments.map((s) => s.id);
                await this.ctx.database.set(
                    TableName.DialogueSegments,
                    { id: { $in: oldSegmentIds } },
                    { status: SegmentStatus.Closed }
                );
                /* prettier-ignore */
                this._logger.warn(`发现并关闭了 ${openSegments.length} 个冗余的开放片段 | 频道: ${platform}:${channelId}`);
            }
            return currentSegment;
        }

        // 如果没有开放的片段，则创建一个新的
        const newSegment: DialogueSegmentData = {
            id: randomUUID(),
            platform,
            channelId,
            guildId,
            status: SegmentStatus.Open,
            agentTurn: null,
            timestamp: new Date(),
        };
        await this.ctx.database.create(TableName.DialogueSegments, newSegment);
        return newSegment;
    }

    /**
     * 将一条消息记录到指定的对话片段中。
     *
     * @param segmentId 目标对话片段的 ID。
     * @param message 包含消息所有必要信息的对象，不含 `sid`。
     */
    public async recordMessage(segmentId: string, message: Omit<MessageData, "sid">): Promise<void> {
        try {
            await this.ctx.database.create(TableName.Messages, { ...message, sid: segmentId });
        } catch (error) {
            this._logger.error(`记录消息失败 | 片段ID: ${segmentId} | 消息ID: ${message.id}`);
        }
    }

    // #endregion

    // =================================================================================
    // #region 事件处理
    // =================================================================================

    /**
     * 注册服务所需的所有事件监听器。
     */
    private registerEventListeners(): void {
        // 1. [核心逻辑] 使用前置中间件和事件标志来区分普通用户消息和指令。
        //    这个中间件确保所有来自允许频道的消息都被记录，但只有非指令消息会触发 Agent。
        this.disposers.push(
            this.ctx.middleware(async (session, next) => {
                if (!this._isChannelAllowed(session)) {
                    return next();
                }

                // 步骤 1: 无条件记录所有用户发出的消息。
                await this._recordUserMessage(session);

                // 步骤 2: 将控制权交给后续中间件（包括指令系统）。
                await next();

                // 步骤 3: 在整个处理链结束后，检查会话是否被指令处理。
                // `__commandHandled` 标志由我们的 `command/before-execute` 监听器设置。
                if (!session["__commandHandled"]) {
                    // 如果没有指令处理该消息，则视为普通对话，触发 `segment-updated` 以便 Agent 响应。
                    const segmentRecord = await this.getOpenSegment(
                        session.platform,
                        session.channelId,
                        session.guildId
                    );
                    this.ctx.emit("worldstate:segment-updated", session, segmentRecord.id);
                }
            }, true)
        );

        // 2. 监听指令即将执行的事件，记录指令调用，并设置标志。
        this.disposers.push(
            this.ctx.on("command/before-execute", (argv) => {
                // 设置标志，通知上述中间件此会话已被指令接管，不应再触发 Agent。
                argv.session["__commandHandled"] = true;
                this.handleCommandInvocation(argv);
            })
        );

        // 3. 监听机器人即将发送的消息，用于匹配指令的响应。
        this.disposers.push(this.ctx.on("before-send", (session) => this._matchCommandResult(session), true));

        // 4. 监听机器人已发送的消息，记录其内容。
        this.disposers.push(this.ctx.on("after-send", (session) => this._recordBotSentMessage(session), true));

        // 5. 监听所有消息，以捕获操作员（机器人账号手动发送）的消息。
        this.disposers.push(
            this.ctx.on("message", (session) => {
                // 条件：是机器人自己发的，且不是对指令的响应 (session.scope 为空)
                if (session.userId === session.bot.selfId && !session.scope) {
                    this.handleOperatorMessage(session);
                }
            })
        );
    }

    /**
     * 处理操作员（使用机器人账号手动发送）的消息。
     * @param session 消息会话对象。
     */
    private async handleOperatorMessage(session: Session): Promise<void> {
        if (!this._isChannelAllowed(session)) return;

        this._logger.info(`捕获操作员消息 | 操作员: ${session.author.name} | 频道: ${session.cid}`);
        const segment = await this.getOpenSegment(session.platform, session.channelId, session.guildId);
        await this._recordBotSentMessage(session, segment.id);
    }

    /**
     * 处理指令调用事件，记录为系统事件，并设置待定状态。
     * @param argv 指令的参数对象。
     */
    private async handleCommandInvocation(argv: Argv): Promise<void> {
        const { session, command, args, options, source } = argv;
        if (!session) return;

        this._logger.info(`捕获指令调用 | 用户: ${session.author.name} | 指令: ${command.name} | 频道: ${session.cid}`);

        const segmentRecord = await this.getOpenSegment(session.platform, session.channelId, session.guildId);
        const commandEventId = `cmd_invoked_${session.messageId || Random.id()}`;

        const eventPayload: CommandInvocationPayload = {
            name: command.name,
            args,
            options,
            raw: source,
            invoker: { pid: session.userId, name: session.author.nick || session.author.name },
        };

        await this.ctx.database.create(TableName.SystemEvents, {
            id: commandEventId,
            sid: segmentRecord.id,
            type: "command-invoked",
            timestamp: new Date(),
            payload: eventPayload,
        });

        // 在内存中创建待定状态，用于将来匹配指令的输出结果。
        const pendingList = this.pendingCommands.get(session.channelId) || [];
        pendingList.push({
            commandEventId,
            scope: session.scope,
            invokerId: session.userId,
            timestamp: Date.now(),
        });
        this.pendingCommands.set(session.channelId, pendingList);
    }

    /**
     * 在消息发送前，匹配待处理的指令结果并更新对应的 SystemEvent。
     * @param session 即将发送消息的会话对象。
     */
    private async _matchCommandResult(session: Session): Promise<void> {
        if (!session.scope) return; // 只关心有 scope 的会话，它们是指令回复的候选

        const pendingInChannel = this.pendingCommands.get(session.channelId);
        if (!pendingInChannel?.length) return;

        const pendingIndex = pendingInChannel.findIndex((p) => p.scope === session.scope);
        if (pendingIndex === -1) return;

        const [pendingCmd] = pendingInChannel.splice(pendingIndex, 1);
        this._logger.debug(`匹配到指令结果 | 事件ID: ${pendingCmd.commandEventId}`);

        const [existingEvent] = await this.ctx.database.get(TableName.SystemEvents, { id: pendingCmd.commandEventId });
        if (existingEvent) {
            const updatedPayload = { ...existingEvent.payload, result: session.content };
            await this.ctx.database.set(
                TableName.SystemEvents,
                { id: pendingCmd.commandEventId },
                { payload: updatedPayload }
            );
        }
    }

    // #endregion

    // =================================================================================
    // #region 指令处理 (Command Handling)
    // =================================================================================

    /**
     * 注册服务的 CLI 指令。
     */
    private registerCommands(): void {
        const historyCmd = this.ctx.command("history", "历史记录管理指令集", { authority: 3 });

        historyCmd
            .subcommand(".count", "统计历史记录中激活的消息数量")
            .option("platform", "-p <platform:string> 指定平台")
            .option("channel", "-c <channel:string> 指定频道ID")
            .option("target", "-t <target:string> 指定目标 'platform:channelId'")
            .action(async ({ session, options }) => {
                let platform = options.platform || session.platform;
                let channelId = options.channel || session.channelId;

                // 从 -t, --target 解析
                if (options.target) {
                    const parts = options.target.split(":");
                    if (parts.length < 2) {
                        return `❌ 格式错误的目标: "${options.target}"，已跳过。`;
                    }
                    platform = parts[0];
                    channelId = parts.slice(1).join(":");
                }

                // 从 -c, --channel 解析
                if (channelId) {
                    if (!platform) {
                        // 未指定平台，需要查找
                        const dialogues = await this.ctx.database.get(TableName.DialogueSegments, { channelId }, [
                            "platform",
                        ]);
                        const platforms = [...new Set(dialogues.map((d) => d.platform))];

                        if (platforms.length === 0) {
                            return `🟡 频道 "${channelId}" 未找到任何历史记录，已跳过。`;
                        } else if (platforms.length === 1) {
                            platform = platforms[0];
                        } else {
                            /* prettier-ignore */
                            return `❌ 频道 "${channelId}" 存在于多个平台: ${platforms.join(", " )}。请使用 -p <platform> 来指定。`;
                        }
                    }
                }

                const segments = await this.ctx.database
                    .select(TableName.DialogueSegments)
                    .where({ platform, channelId, status: { $ne: "archived" } })
                    .execute();

                const allMessages = await this.ctx.database
                    .select(TableName.Messages)
                    .where({ sid: { $in: segments.map((s) => s.id) } })
                    .execute();

                return `在 ${platform}:${channelId} 中有 ${allMessages.length} 条激活的消息。`;
            });

        historyCmd.subcommand(".summarize", "手动触发当前频道的历史记录总结").action(async ({ session }) => {
            try {
                await this.summarizeAndArchive(session.platform, session.channelId);
                return "✅ 手动总结任务已触发并完成。";
            } catch (error) {
                this._logger.error(error, `[指令] 手动总结任务失败 | 频道: ${session.cid}`);
                return "❌ 总结任务失败，请检查日志。";
            }
        });

        historyCmd
            .subcommand(".clear", "清除指定频道的历史记录", { authority: 3 })
            .option("all", "-a <type:string> 清理全部指定类型的频道 (private, guild, all)")
            .option("platform", "-p <platform:string> 指定平台")
            .option("channel", "-c <channel:string> 指定频道ID (多个用逗号分隔)")
            .option("target", "-t <target:string> 指定目标 'platform:channelId' (多个用逗号分隔)")
            .option("delete", "--delete 永久删除记录(包括关联消息)，而非归档", { type: "boolean" })
            .usage(
                `清除历史记录的强大工具。
默认操作是将消息标记为“已归档”，数据仍保留在数据库中。
使用 --delete 选项会从数据库中永久移除相关对话、消息和系统事件，此操作不可恢复。

当单独使用 -c 指定的频道ID存在于多个平台时，指令会要求您使用 -p 或 -t 来明确指定平台。`
            )
            .example(
                [
                    "",
                    "history.clear                      # 清除当前频道的历史记录",
                    "history.clear -c 12345678          # 清除频道 12345678 的历史记录",
                    "history.clear -p discord -c 987654321 # 清除 discord 平台下频道 987654321 的记录",
                    "history.clear -t onebot:private:10001 # 清除 onebot 平台下私聊 10001 的记录",
                    "history.clear -a private           # 归档所有私聊频道的历史记录",
                    "history.clear -a guild --delete    # 永久删除所有群聊对话及关联消息",
                    "history.clear -a all --delete      # !! 永久删除所有历史记录，极度危险 !!",
                ].join("\n")
            )
            .action(async ({ session, options }) => {
                const isDelete = !!options.delete;
                const actionPastTense = isDelete ? "永久删除" : "归档";
                const results: string[] = [];

                // 辅助函数：执行清理操作，现在支持事务和多表操作
                const performClear = async (query: Query<DialogueSegmentData>, description: string) => {
                    try {
                        // 步骤1: 查找需要操作的对话片段及其ID
                        const segmentsToClear = await this.ctx.database.get(TableName.DialogueSegments, query, ["id"]);

                        if (segmentsToClear.length === 0) {
                            results.push(`🟡 ${description} - 未找到匹配的历史记录。`);
                            return;
                        }
                        const segmentIds = segmentsToClear.map((s) => s.id);

                        // 步骤2: 使用事务执行数据库操作以保证原子性
                        await this.ctx.database.transact(async (db) => {
                            if (isDelete) {
                                // 永久删除模式：删除所有三张表的数据
                                // 使用 $in 操作符批量删除
                                await db.remove(TableName.Messages, { sid: { $in: segmentIds } });
                                await db.remove(TableName.SystemEvents, { sid: { $in: segmentIds } });
                                await db.remove(TableName.DialogueSegments, { id: { $in: segmentIds } });
                                const recordCount = segmentsToClear.length;
                                results.push(`✅ ${description} - ${recordCount} 条对话片段已${actionPastTense}。`);
                            } else {
                                // 归档模式：只更新对话片段的状态
                                /* prettier-ignore */
                                const writeResult = await db.set(TableName.DialogueSegments, { ...query as any, status: { $ne: SegmentStatus.Archived } }, { status: SegmentStatus.Archived });
                                /* prettier-ignore */
                                results.push(`✅ ${description} - ${writeResult.modified || writeResult.matched || 0} 条对话片段已${actionPastTense}。`);
                            }
                        });
                    } catch (error) {
                        this.ctx.logger.warn(`为 ${description} 清理历史记录时失败:`, error);
                        results.push(`❌ ${description} - 操作失败，数据库更改已回滚。`);
                    }
                };

                // 选项解析和执行逻辑
                // 1. 处理 -a, --all 选项
                if (options.all) {
                    if (!["private", "guild", "all"].includes(options.all)) {
                        return "错误：-a, --all 的参数必须是 'private', 'guild', 或 'all'。";
                    }
                    let query: Query<DialogueSegmentData> = {};
                    let description = "";

                    switch (options.all) {
                        case "private":
                            query = { channelId: { $regex: /^private:/ } };
                            description = "所有私聊频道";
                            break;
                        case "guild":
                            query = { channelId: { $not: /^private:/ } };
                            description = "所有群聊频道";
                            break;
                        case "all":
                            query = {};
                            description = "所有频道";
                            break;
                    }
                    await performClear(query, description);
                    return results.join("\n");
                }

                // 2. 收集需要处理的目标
                const targetsToProcess: { platform: string; channelId: string }[] = [];
                const ambiguousChannels: string[] = [];

                // 从 -t, --target 解析
                if (options.target) {
                    const targets = options.target
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean);
                    for (const target of targets) {
                        const parts = target.split(":");
                        if (parts.length < 2) {
                            results.push(`❌ 格式错误的目标: "${target}"，已跳过。`);
                            continue;
                        }
                        const platform = parts[0];
                        const channelId = parts.slice(1).join(":");
                        targetsToProcess.push({ platform, channelId });
                    }
                }

                // 从 -c, --channel 解析
                if (options.channel) {
                    const channels = options.channel
                        .split(",")
                        .map((c) => c.trim())
                        .filter(Boolean);
                    for (const channelId of channels) {
                        if (options.platform) {
                            targetsToProcess.push({ platform: options.platform, channelId });
                        } else {
                            // 未指定平台，需要查找
                            const dialogues = await this.ctx.database.get(TableName.DialogueSegments, { channelId }, [
                                "platform",
                            ]);
                            const platforms = [...new Set(dialogues.map((d) => d.platform))];

                            if (platforms.length === 0) {
                                results.push(`🟡 频道 "${channelId}" 未找到任何历史记录，已跳过。`);
                            } else if (platforms.length === 1) {
                                targetsToProcess.push({ platform: platforms[0], channelId });
                            } else {
                                ambiguousChannels.push(`频道 "${channelId}" 存在于多个平台: ${platforms.join(", ")}。`);
                            }
                        }
                    }
                }

                if (ambiguousChannels.length > 0) {
                    /* prettier-ignore */
                    return `操作已中止。存在需要明确指定的频道：\n${ambiguousChannels.join("\n")}\n请使用 -p <platform> 或 -t <platform:channelId> 来指定。`;
                }

                // 4. 如果没有指定任何目标，则清理当前会话
                if (targetsToProcess.length === 0 && !options.target && !options.channel) {
                    if (session.platform && session.channelId) {
                        targetsToProcess.push({ platform: session.platform, channelId: session.channelId });
                    } else {
                        return "无法确定当前会话，请使用选项指定要清理的频道。";
                    }
                }

                if (targetsToProcess.length === 0 && results.length === 0) {
                    return "没有指定任何有效的清理目标。请使用 'help history.clear' 查看帮助。";
                }

                // 5. 执行清理操作
                for (const target of targetsToProcess) {
                    await performClear(
                        { platform: target.platform, channelId: target.channelId },
                        `目标 "${target.platform}:${target.channelId}"`
                    );
                }

                // 6. 返回最终结果
                const actionVerb = isDelete ? "永久删除" : "归档";
                return `--- 清理报告 ---\n操作类型：${actionVerb}\n${results.join("\n")}`;
            });
    }

    // #endregion

    // =================================================================================
    // #region 上下文构建
    // =================================================================================

    /**
     * 为单个频道构建完整的上下文信息。
     * 这是一个分发器，根据频道ID的格式决定是构建公会频道还是私聊频道的上下文。
     * @param channel 频道描述符，包含平台和频道ID。
     * @returns 一个完整的 `Channel` 对象。
     */
    private async buildFullContextForChannel(channel: ChannelDescriptor): Promise<Channel> {
        const { platform, id } = channel;
        const bot = this.ctx.bots.find((b) => b.platform === platform && b.isActive);

        if (!bot) {
            this._logger.warn(`找不到平台 ${platform} 的在线机器人，无法构建完整频道上下文 | 频道: ${id}`);
            return {
                id,
                platform,
                name: `Offline Channel ${id}`,
                type: "unknown",
                meta: {},
                members: [],
                history: { pending: undefined },
            };
        }

        return id.startsWith("private:")
            ? this._buildPrivateChannelContext(bot, channel)
            : this._buildGuildChannelContext(bot, channel);
    }

    /**
     * 构建私聊频道的上下文。
     */
    private async _buildPrivateChannelContext(bot: Bot, channel: ChannelDescriptor): Promise<Channel> {
        const { platform, id } = channel;
        const userId = id.substring("private:".length);

        const [user, history] = await Promise.all([
            bot.getUser(userId).catch(() => {
                this._logger.warn(`[核心] 获取用户信息失败，将使用基础信息 | 用户: ${platform}:${userId}`);
                return null;
            }),
            this._fetchAndBuildHistory(channel),
        ]);

        const userName = user?.name || user?.nick || userId;
        const members: GuildMember[] = [
            {
                pid: bot.selfId,
                name: bot.user.name,
                nick: bot.user.nick || bot.user.name,
                roles: ["assistant", "bot"],
                isSelf: true,
            },
            { pid: userId, name: userName, nick: user?.nick || userName, roles: ["user"], isSelf: false },
        ];

        return { id, platform, name: `与 ${userName} 的私聊`, type: "private", meta: {}, members, history };
    }

    /**
     * 构建公会频道的上下文。
     */
    private async _buildGuildChannelContext(bot: Bot, channel: ChannelDescriptor): Promise<Channel> {
        const { platform, id } = channel;

        const [channelInfo, history] = await Promise.all([
            bot.getChannel(id).catch(() => {
                this._logger.warn(`[核心] 获取频道信息失败，将使用基础信息 | 频道: ${platform}:${id}`);
                return null;
            }),
            this._fetchAndBuildHistory(channel),
        ]);

        if (!channelInfo) {
            return { id, platform, name: `Channel ${id}`, type: "guild", meta: {}, members: [], history };
        }

        const members = await this._getMembersFromHistory(bot, history, platform, channelInfo.guildId || id);

        return { id, platform, name: channelInfo.name, type: "guild", meta: { ...channelInfo }, members, history };
    }

    /**
     * 从数据库获取并构建完整的对话历史记录。
     */
    private async _fetchAndBuildHistory(channel: ChannelDescriptor): Promise<History> {
        const { platform, id: channelId } = channel;

        const [pendingSegment, closedSegments, foldedSegments, summarizedSegment] = await Promise.all([
            this.ctx.database
                .get(TableName.DialogueSegments, { platform, channelId, status: "open" })
                .then((res) => res[0]),
            this.ctx.database
                .select(TableName.DialogueSegments)
                .where({ platform, channelId, status: "closed" })
                .orderBy("timestamp", "desc")
                .limit(this.config.fullContextSegmentCount)
                .execute()
                .then((res) => res.reverse()),
            this.ctx.database
                .select(TableName.DialogueSegments)
                .where({ platform, channelId, status: "folded" })
                .orderBy("timestamp", "desc")
                .limit(this.config.summarizationTriggerCount)
                .execute()
                .then((res) => res.reverse()),
            this.ctx.database
                .select(TableName.DialogueSegments)
                .where({ platform, channelId, status: "summarized" })
                .orderBy("timestamp", "desc")
                .limit(1)
                .execute()
                .then((res) => res[0]),
        ]);

        const [pending, closed, folded, summarized] = await Promise.all([
            pendingSegment ? this.buildDialogueSegment(pendingSegment) : Promise.resolve(undefined),
            Promise.all(closedSegments.map((r) => this.buildClosedSegment(r))),
            foldedSegments.length > 0 ? this.buildFoldedDialogueSegment(foldedSegments) : Promise.resolve(undefined),
            summarizedSegment ? this.buildSummarizedDialogueSegment(summarizedSegment) : Promise.resolve(undefined),
        ]);

        return { pending, closed, folded, summarized };
    }

    /**
     * 根据数据库记录高效地构建完整的 `DialogueSegment` 对象。
     */
    public async buildDialogueSegment(segmentRecord: DialogueSegmentData): Promise<DialogueSegment> {
        const dialogueSegment: DialogueSegment = {
            type: "dialogue-segment",
            id: segmentRecord.id,
            platform: segmentRecord.platform,
            channelId: segmentRecord.channelId,
            guildId: segmentRecord.guildId,
            status: segmentRecord.status,
            summary: segmentRecord.summary,
            timestamp: segmentRecord.timestamp,
            agentTurn: segmentRecord.agentTurn,
            dialogue: [],
            systemEvents: [],
        };

        // 核心性能优化：根据片段状态决定是否查询详细内容。
        if (segmentRecord.status === "summarized") {
            dialogueSegment.agentTurn = null; // 总结片段不应有关联的 Agent 回合
            return dialogueSegment;
        }

        const [messageRecords, systemEventRecords] = await Promise.all([
            this.ctx.database.get(TableName.Messages, { sid: segmentRecord.id }),
            this.ctx.database.get(TableName.SystemEvents, { sid: segmentRecord.id }),
        ]);

        dialogueSegment.dialogue = this.buildDialogueMessages(messageRecords);

        dialogueSegment.systemEvents = systemEventRecords.map((record) => ({
            id: record.id,
            type: record.type,
            timestamp: record.timestamp,
            date: formatDate(record.timestamp),
            payload: record.payload,
        }));

        // 对于 folded 状态，隐藏 agentTurn 的细节
        if (dialogueSegment.status === "folded" && dialogueSegment.agentTurn) {
            dialogueSegment.agentTurn.responses = [];
        }

        return dialogueSegment;
    }

    /**
     * 构建一个已关闭的对话片段对象。
     */
    private async buildClosedSegment(record: DialogueSegmentData): Promise<ClosedDialogueSegment> {
        const dialogueSegment: ClosedDialogueSegment = {
            type: "dialogue-segment",
            id: record.id,
            platform: record.platform,
            channelId: record.channelId,
            guildId: record.guildId,
            status: "closed",
            summary: record.summary,
            timestamp: record.timestamp,
            agentTurn: record.agentTurn,
            dialogue: [],
        };

        // 核心性能优化：根据片段状态决定是否查询详细内容。
        if (record.status === "summarized") {
            dialogueSegment.agentTurn = null; // 总结片段不应有关联的 Agent 回合
            return dialogueSegment;
        }

        const messageRecords = await this.ctx.database.get(TableName.Messages, { sid: record.id });

        dialogueSegment.dialogue = this.buildDialogueMessages(messageRecords);

        return dialogueSegment;
    }

    /**
     * 构建一个被折叠的对话片段集合对象。
     */
    async buildFoldedDialogueSegment(foldedSegments: DialogueSegmentData[]): Promise<FoldedDialogueSegment> {
        // 收集所有消息
        const allMessages = await this.ctx.database
            .select(TableName.Messages)
            .where({ sid: { $in: foldedSegments.map((s) => s.id) } })
            .orderBy("timestamp", "asc")
            .execute();

        // 收集所有系统事件
        const allSystemEvents = await this.ctx.database
            .select(TableName.SystemEvents)
            .where({ sid: { $in: foldedSegments.map((s) => s.id) } })
            .orderBy("timestamp", "asc")
            .execute();

        // 时间窗口
        const startTimestamp = foldedSegments[0].timestamp;
        const endTimestamp = foldedSegments[foldedSegments.length - 1].timestamp;

        return {
            type: "dialogue-segment",
            id: foldedSegments[0].id,
            platform: foldedSegments[0].platform,
            channelId: foldedSegments[0].channelId,
            guildId: foldedSegments[0].guildId,
            status: "folded",
            dialogue: this.buildDialogueMessages(allMessages),
            systemEvents: allSystemEvents.map((record) => ({
                id: record.id,
                type: record.type,
                timestamp: record.timestamp,
                date: formatDate(record.timestamp),
                payload: record.payload,
            })),
            timestamp: startTimestamp,
            endTimestamp,
        };
    }

    /**
     * 构建一个已总结的对话片段对象。
     */
    private async buildSummarizedDialogueSegment(record: DialogueSegmentData): Promise<SummarizedDialogueSegment> {
        return {
            type: "dialogue-segment",
            id: record.id,
            platform: record.platform,
            channelId: record.channelId,
            guildId: record.guildId,
            status: "summarized",
            summary: record.summary,
            timestamp: record.timestamp,
            dialogue: [],
            systemEvents: [],
            agentTurn: undefined,
            endTimestamp: record.timestamp,
        };
    }

    // #endregion

    // =================================================================================
    // #region 数据持久化与操作 (Data Persistence & Manipulation)
    // =================================================================================

    /**
     * 注册所有数据库模型。
     */
    private registerDatabaseModels(): void {
        this.ctx.model.extend(
            TableName.Members,
            {
                pid: "string(255)",
                platform: "string(255)",
                guildId: "string(255)",
                name: "string(255)",
                roles: "json",
                avatar: "string(255)",
                joinedAt: "timestamp",
                lastActive: "timestamp",
            },
            { autoInc: false, primary: ["pid", "platform", "guildId"] }
        );

        this.ctx.model.extend(
            TableName.DialogueSegments,
            {
                id: "string(64)",
                platform: "string(255)",
                channelId: "string(255)",
                guildId: "string(255)",
                status: "string(32)",
                summary: "text",
                agentTurn: "json",
                timestamp: "timestamp",
            },
            { primary: "id" }
        );

        this.ctx.model.extend(
            TableName.Messages,
            {
                id: "string(255)",
                platform: "string(255)",
                sid: "string(64)",
                channelId: "string(255)",
                sender: "object",
                timestamp: "timestamp",
                content: "text",
                quoteId: "string(255)",
            },
            { foreign: { sid: [TableName.DialogueSegments, "id"] } }
        );

        this.ctx.model.extend(
            TableName.SystemEvents,
            {
                id: "string(64)",
                sid: "string(64)",
                type: "string(64)",
                timestamp: "timestamp",
                payload: "json",
            },
            { primary: "id", foreign: { sid: [TableName.DialogueSegments, "id"] } }
        );
    }

    /**
     * 记录一条用户消息到数据库。
     * @param session 消息会话。
     */
    private async _recordUserMessage(session: Session): Promise<void> {
        /* prettier-ignore */
        this._logger.info( `捕获用户消息 | 用户: ${session.author.name} | 频道: ${session.cid} | 内容: ${truncate(session.content).replace(/\n/g, " ")}`);

        const segment = await this.getOpenSegment(session.platform, session.channelId, session.guildId);
        if (session.guildId) {
            await this._updateMemberInfo(session);
        }

        const content = await this._transformMessageContent(session.elements, session);
        await this.recordMessage(segment.id, {
            id: session.messageId,
            platform: session.platform,
            channelId: session.channelId,
            sender: {
                id: session.userId,
                name: session.author.nick || session.author.name,
                roles: session.author.roles,
            },
            content,
            timestamp: new Date(session.timestamp),
            quoteId: session.quote?.id,
        });
    }

    /**
     * 记录一条机器人发送的消息。
     * @param session 已发送消息的会话对象。
     * @param segmentId 可选，如果已知片段ID，可直接传入。
     */
    private async _recordBotSentMessage(session: Session, segmentId?: string): Promise<void> {
        if (!session.content || !session.messageId) return;

        this._logger.debug(`记录机器人消息 | 频道: ${session.cid} | 消息ID: ${session.messageId}`);
        const sid = segmentId || (await this.getOpenSegment(session.platform, session.channelId, session.guildId)).id;

        await this.recordMessage(sid, {
            id: session.messageId,
            platform: session.platform,
            channelId: session.channelId,
            sender: { id: session.bot.selfId, name: session.bot.user.nick || session.bot.user.name },
            content: session.content,
            timestamp: new Date(),
        });
    }

    /**
     * 更新或插入成员信息到数据库。
     * @param session 包含作者信息的消息会话。
     */
    private async _updateMemberInfo(session: Session): Promise<void> {
        if (!session.guildId || !session.author) return;

        try {
            const memberKey = {
                pid: session.userId,
                platform: session.platform,
                guildId: session.guildId,
            };

            const memberData = {
                name: session.author.nick || session.author.name,
                roles: session.author.roles,
                avatar: session.author.avatar,
                lastActive: new Date(),
            };

            const existing = await this.ctx.database.get(TableName.Members, memberKey);

            if (existing.length > 0) {
                await this.ctx.database.set(TableName.Members, memberKey, memberData);
            } else {
                await this.ctx.database.create(TableName.Members, {
                    ...memberKey,
                    ...memberData,
                });
            }
        } catch (error) {
            this.logger.error(`更新成员信息失败: ${error.message}`);
        }
    }

    /**
     * 应用上下文折叠策略：如果 `closed` 状态的片段数量超过阈值，则将最旧的片段标记为 `folded`。
     */
    private async applyFoldingPolicy(platform: string, channelId: string): Promise<void> {
        const closedSegments = await this.ctx.database.get(TableName.DialogueSegments, {
            platform,
            channelId,
            status: SegmentStatus.Closed,
        });

        if (closedSegments.length > this.config.fullContextSegmentCount) {
            const segmentsToFold = closedSegments
                .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                .slice(0, closedSegments.length - this.config.fullContextSegmentCount);

            const idsToFold = segmentsToFold.map((s) => s.id);
            if (idsToFold.length > 0) {
                await this.ctx.database.set(
                    TableName.DialogueSegments,
                    { id: { $in: idsToFold } },
                    { status: SegmentStatus.Folded }
                );
                this._logger.debug(`折叠了 ${idsToFold.length} 个旧片段 | 频道: ${platform}:${channelId}`);
            }
        }
    }

    // #endregion

    // =================================================================================
    // #region 后台维护
    // =================================================================================

    /**
     * 运行周期性维护任务。
     */
    private runMaintenanceTasks(): void {
        this._cleanupPendingCommands();

        this._cleanupExpiredRecords().catch((error) => {
            this._logger.error("清理过期记录任务执行失败", error);
        });

        if (this.config.enableSummarization && this.chatModel) {
            this.triggerSummarizationForEligibleChannels().catch((error) => {
                this._logger.error("自动总结任务执行失败", error);
            });
        }
    }

    /**
     * 清理过期的对话片段及消息记录
     */
    private async _cleanupExpiredRecords(): Promise<void> {
        const expirationTime = this.config.advanced.dataRetentionDays * 24 * 60 * 60 * 1000;
        const expirationCutoff = new Date(Date.now() - expirationTime);

        /* prettier-ignore */
        const expiredSegments = await this.ctx.database.get(TableName.DialogueSegments, { timestamp: { $lt: expirationCutoff } });

        if (expiredSegments.length > 0) {
            const segmentIds = expiredSegments.map((s) => s.id);
            await this.ctx.database.withTransaction(async (db) => {
                await db.remove(TableName.Messages, { sid: { $in: segmentIds } });
                await db.remove(TableName.SystemEvents, { sid: { $in: segmentIds } });
                await db.remove(TableName.DialogueSegments, { id: { $in: segmentIds } });
            });
            this._logger.info(`清理了 ${expiredSegments.length} 个过期的对话片段及其相关记录。`);
        }
    }

    /**
     * 清理过期的待定指令，防止内存泄漏。
     */
    private _cleanupPendingCommands(): void {
        const now = Date.now();
        const expirationTime = 5 * 60 * 1000; // 5 分钟
        let cleanedCount = 0;

        for (const [channelId, commands] of this.pendingCommands.entries()) {
            const initialCount = commands.length;
            const activeCommands = commands.filter((cmd) => now - cmd.timestamp < expirationTime);
            cleanedCount += initialCount - activeCommands.length;

            if (activeCommands.length === 0) {
                this.pendingCommands.delete(channelId);
            } else {
                this.pendingCommands.set(channelId, activeCommands);
            }
        }
        if (cleanedCount > 0) {
            this._logger.debug(`清理了 ${cleanedCount} 个过期待定指令。`);
        }
    }

    /**
     * 查找并触发符合总结条件的频道的总结归档流程。
     */
    private async triggerSummarizationForEligibleChannels(): Promise<void> {
        const channels = await this._findChannelsWithSufficientFoldedSegments();
        if (channels.length > 0) {
            this._logger.info(`发现 ${channels.length} 个频道符合自动总结条件。`);
            await Promise.all(channels.map((ch) => this.summarizeAndArchive(ch.platform, ch.channelId)));
        }
    }

    /**
     * 查找哪些频道有足够多的 'folded' 片段以触发总结。
     */
    private async _findChannelsWithSufficientFoldedSegments(): Promise<{ platform: string; channelId: string }[]> {
        const allFoldedSegments = await this.ctx.database.get(TableName.DialogueSegments, { status: "folded" });

        const channelCounts = new Map<string, number>();
        const channelMetas = new Map<string, { platform: string; channelId: string }>();

        for (const segment of allFoldedSegments) {
            const key = `${segment.platform}:${segment.channelId}`;
            channelCounts.set(key, (channelCounts.get(key) || 0) + 1);
            if (!channelMetas.has(key)) {
                channelMetas.set(key, { platform: segment.platform, channelId: segment.channelId });
            }
        }

        const channelsToProcess: { platform: string; channelId: string }[] = [];
        for (const [key, count] of channelCounts.entries()) {
            if (count >= this.config.summarizationTriggerCount) {
                /* prettier-ignore */
                this._logger.debug(`频道 ${key} 有 ${count} 个 folded 片段，达到总结阈值 ${this.config.summarizationTriggerCount}。`);
                channelsToProcess.push(channelMetas.get(key)!);
            }
        }
        return channelsToProcess;
    }

    /**
     * 对指定频道的 'folded' 片段进行总结和归档，采用滚动总结策略。
     * @param platform 平台名称。
     * @param channelId 频道 ID。
     */
    private async summarizeAndArchive(platform: string, channelId: string): Promise<void> {
        // 检查是否正在处理中
        if (this.summarizingChannels.has(`${platform}:${channelId}`)) {
            this._logger.debug(`频道 ${platform}:${channelId} 正在处理中，跳过`);
            return;
        }

        this._logger.info(`开始处理滚动总结 | 频道: ${platform}:${channelId}`);

        // 步骤 1: 获取所有待总结的 'folded' 片段
        const foldedSegments = await this.ctx.database
            .get(TableName.DialogueSegments, { platform, channelId, status: SegmentStatus.Folded })
            .then((res) => res.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()));

        if (foldedSegments.length < this.config.summarizationTriggerCount) {
            /* prettier-ignore */
            this._logger.debug(`片段数量 (${foldedSegments.length}) 未达阈值 (${this.config.summarizationTriggerCount})，跳过 | 频道: ${channelId}`);
            return;
        }

        // 步骤 2: 获取上一次的总结
        const previousSummarySegment = await this.ctx.database
            .get(TableName.DialogueSegments, { platform, channelId, status: SegmentStatus.Summarized })
            .then((res) => res.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0]);

        // 步骤 3: 渲染新的对话内容为文本
        const newMessagesText = await this.renderSegmentsToTextForSummary(foldedSegments);
        if (!newMessagesText) {
            this._logger.warn(`无法为频道 ${channelId} 的新消息生成对话文本，将直接归档，避免阻塞。`);
            await this.ctx.database.set(
                TableName.DialogueSegments,
                { id: { $in: foldedSegments.map((s) => s.id) } },
                { status: SegmentStatus.Archived }
            );
            return;
        }

        this.ctx.emit("worldstate:summary", foldedSegments);

        const bot = this.ctx.bots.find((b) => b.platform === platform);
        if (!bot) {
            this._logger.error(`未找到 ${platform} 平台的机器人实例，无法进行总结 | 频道: ${channelId}`);
            return;
        }

        // 4. 构建模型所需的 Prompt
        const aiIdentity = `ID: ${bot.selfId}, 昵称: ${bot.user.name || "AI Assistant"}`;

        const renderContext = {
            aiIdentity,
            previousSummary: previousSummarySegment?.summary,
            newMessages: newMessagesText,
        };

        const prompt = await this.promptService.render("worldstate.summarization", renderContext);

        // 5. 调用模型生成新总结
        const summaryResponse = await this.chatModel
            .chat({
                messages: [{ role: "user", content: prompt }],
                temperature: 0.2,
            })
            .catch((e) => {
                this._logger.error(e, `模型调用失败 | 频道: ${channelId}`);
                return null;
            });
        const newSummaryText = summaryResponse?.text;

        if (!newSummaryText) {
            /* prettier-ignore */
            this._logger.warn(`模型未返回有效的总结内容，将直接归档所有 folded 和旧 summarized 片段 | 频道: ${channelId}`);
            // 即使总结失败，也要清理，避免无限重试
            const idsToArchive = foldedSegments.map((s) => s.id);
            if (previousSummarySegment) {
                idsToArchive.push(previousSummarySegment.id);
            }
            await this.ctx.database.set(
                TableName.DialogueSegments,
                { id: { $in: idsToArchive } },
                { status: SegmentStatus.Archived }
            );
            return;
        }

        // 6. 创建新的总结片段
        const latestTimestamp = foldedSegments[foldedSegments.length - 1].timestamp;
        const newSummarySegment: DialogueSegmentData = {
            id: randomUUID(),
            platform: platform,
            channelId: channelId,
            guildId: foldedSegments[0].guildId,
            status: SegmentStatus.Summarized,
            summary: newSummaryText,
            timestamp: latestTimestamp, // 时间戳更新为最新内容的结束时间
            agentTurn: null,
        };

        // 7. 在一个事务中完成所有数据库操作
        const idsToArchive = foldedSegments.map((s) => s.id);
        if (previousSummarySegment) {
            idsToArchive.push(previousSummarySegment.id);
        }

        await this.ctx.database.withTransaction(async (db) => {
            await db.create(TableName.DialogueSegments, newSummarySegment);
            if (idsToArchive.length > 0) {
                await db.set(
                    TableName.DialogueSegments,
                    { id: { $in: idsToArchive } },
                    { status: SegmentStatus.Archived }
                );
            }
        });

        /* prettier-ignore */
        this._logger.info(`[滚动总结] 成功 | 频道: ${channelId} | 新总结ID: ${newSummarySegment.id} | 归档了 ${idsToArchive.length} 个旧片段。`);
    }

    /**
     * 将一组对话片段渲染为纯文本，专用于总结任务。
     */
    private async renderSegmentsToTextForSummary(segments: DialogueSegmentData[]): Promise<string> {
        if (!segments || segments.length === 0) return "";

        const segmentIds = segments.map((segment) => segment.id);

        // 1. 一次性获取所有相关消息和系统事件，并按时间排序
        const [allMessages, allSystemEvents] = await Promise.all([
            this.ctx.database.get(TableName.Messages, { sid: { $in: segmentIds } }),
            this.ctx.database.get(TableName.SystemEvents, { sid: { $in: segmentIds } }),
        ]);

        // 将消息和事件合并到一个数组中进行统一排序
        const allItems = [
            ...allMessages.map((item) => ({ ...item, itemType: "message" })),
            ...allSystemEvents.map((item) => ({ ...item, itemType: "event" })),
        ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        if (allItems.length === 0) return "";

        // 2. 收集所有唯一的发送者ID，仅从消息中收集
        const senderIds = [...new Set(allMessages.map((msg) => msg.sender.id))];
        const membersMap = new Map<string, MemberData>();
        if (senderIds.length > 0) {
            const membersData = await this.ctx.database.get(TableName.Members, {
                platform: segments[0].platform,
                pid: { $in: senderIds },
            });
            membersData.forEach((member) => membersMap.set(member.pid, member));
        }

        // 3. 格式化为文本
        const dialogueLines = allItems
            .map((item) => {
                const timestampStr = formatDate(item.timestamp, "HH:mm:ss");

                if (item.itemType === "message") {
                    const msg = item as MessageData;
                    const member = membersMap.get(msg.sender.id);
                    const senderName = member?.name || msg.sender.name || msg.sender.id;
                    const contentText = h
                        .parse(msg.content)
                        .map((el) => el.toString())
                        .join("")
                        .trim();
                    if (!contentText) return null;
                    return `[${timestampStr}] ${senderName}: ${contentText.replace(/\n/g, " ")}`;
                }

                if (item.itemType === "event" && (item as SystemEventData).type === "command-invoked") {
                    const event = item as SystemEventData;
                    const payload = event.payload as CommandInvocationPayload;
                    return `[${timestampStr}] [系统事件] 用户 ${payload.invoker.name} 调用了指令: ${payload.name}。`;
                }

                return null; // 忽略其他类型的系统事件
            })
            .filter(Boolean);

        return dialogueLines.join("\n");
    }

    /**
     * 构建用于滚动总结的、结构化的 Prompt。
     */
    private async buildSummarizationPrompt(
        aiIdentity: string,
        previousSummary: string,
        newMessages: string
    ): Promise<string> {
        // 构建渲染上下文
        const renderContext = {
            aiIdentity,
            previousSummary,
            newMessages,
        };

        const result = await this.promptService.render("worldstate.summarization", renderContext);
        return result;
    }

    // #endregion

    // =================================================================================
    // #region 私有辅助方法 (Private Helpers)
    // =================================================================================

    /**
     * 检查一个会话所在的频道是否被允许记录。
     * @param session 会话对象
     * @returns 是否允许
     */
    private _isChannelAllowed(session: Session): boolean {
        const cid = session.cid;
        const platform = session.platform;
        const allowed = Array.from(this.config.allowedChannels);

        return allowed.some(
            (c) =>
                c === cid || // 精确匹配
                c === "*:*" || // 全局通配符
                c === `${platform}:*` ||
                c === `${platform}:all` ||
                c === `${platform}:private:*` ||
                c === `${platform}:private:all` ||
                c === `${platform}:guild:*` ||
                c === `${platform}:guild:all`
        );
    }

    /**
     * 将 Koishi 的 Element 数组转换为适合存储的字符串。
     * @param elements 消息元素数组。
     * @param session 当前会话，用于处理图片等需要上下文的元素。
     * @returns 转换后的字符串。
     */
    private async _transformMessageContent(elements: Element[], session: Session): Promise<string> {
        const transformedElements = await h.transformAsync(elements, async (element) => {
            if (element.type === "img" || element.type === "image") {
                return this.ctx[Services.Image].processImageElement(element, session);
            }
            return element;
        });
        return transformedElements.join("");
    }

    /**
     * 根据历史记录获取相关成员列表，并注入机器人自身。
     */

    /**
     * 根据历史记录获取相关成员列表，并注入机器人自身。
     * @param bot 机器人实例。
     * @param history 对话历史。
     * @param platform 平台。
     * @param guildId 公会ID。
     * @returns 成员列表。
     */
    private async _getMembersFromHistory(
        bot: Bot,
        history: History,
        platform: string,
        guildId: string
    ): Promise<GuildMember[]> {
        const memberIds = new Set<string>();

        // history.pending.forEach((segment) => {
        //     segment.dialogue.forEach((message) => {
        //         memberIds.add(message.sender.id);
        //     });
        // });

        const allMessages = [history.pending, ...history.closed, history.folded]
            .filter(Boolean)
            .map((segment) => segment.dialogue)
            .flat();

        allMessages.forEach((message) => {
            memberIds.add(message.sender.id);
        });

        const humanMembers: GuildMember[] =
            memberIds.size > 0
                ? await this.ctx.database.get(TableName.Members, {
                      platform: platform,
                      guildId: guildId,
                      pid: { $in: Array.from(memberIds) },
                  })
                : [];

        const botAsMember: GuildMember = {
            pid: bot.selfId,
            name: bot.user.name,
            nick: bot.user.nick || bot.user.name,
            roles: ["assistant", "bot"],
            isSelf: true,
        };

        // 使用 unshift 将机器人放在列表开头，并返回新数组
        return [botAsMember, ...humanMembers];
    }

    /**
     * 构建可供前端渲染的对话消息数组。
     */
    private buildDialogueMessages(messageRecords: MessageData[]): ContextualMessage[] {
        const quotedMsgIds = new Set(messageRecords.filter((m) => m.quoteId).map((m) => m.quoteId));

        return messageRecords.map((record) => ({
            id: record.id,
            content: record.content,
            timestamp: record.timestamp,
            date: formatDate(record.timestamp, "YYYY-MM-DD"),
            time: formatDate(record.timestamp, "HH:mm:ss"),
            quoted: quotedMsgIds.has(record.id),
            quoteId: record.quoteId,
            sender: { id: record.sender.id, name: record.sender.name, roles: record.sender.roles },
        }));
    }

    // #endregion
}

/**
 * 根据最大消息数限制，修剪世界状态中的历史记录。
 *
 * 此函数是不可变的：它不会修改原始的 `worldState` 对象，而是返回一个
 * 经过修剪的新的 `worldState` 对象。
 * 它的裁剪最小单元是“消息”。它会从最旧的对话片段中的最旧消息开始移除，
 * 直到剩余的总消息数不超过限制。如果一个片段在裁剪后变为空，该片段将被移除。
 *
 * @param worldState 原始的世界状态。
 * @param maxMessages 允许的最大消息总数。
 * @returns 一个新的、历史记录被修剪过的 `WorldState` 对象。
 */
export function pruneHistoryByMessages(worldState: WorldState, maxMessages: number): WorldState {
    // 1. 为了保证不可变性，立即创建一个深拷贝。所有修改都将在这个拷贝上进行。
    const newWorldState = structuredClone(worldState);

    // 2. 处理边缘情况：如果允许的最大消息数为0或更少，直接清空所有历史记录。
    if (maxMessages <= 0) {
        newWorldState.channel.history.pending = undefined;
        newWorldState.channel.history.closed = [];
        newWorldState.channel.history.folded = undefined;
        return newWorldState;
    }

    // 3. 收集新 worldState 中所有可操作的对话片段的引用
    const allSegments: (DialogueSegment | FoldedDialogueSegment)[] = [
        newWorldState.channel.history.pending,
        ...(newWorldState.channel.history.closed || []),
        newWorldState.channel.history.folded,
    ].filter(Boolean);

    // 4. 计算当前总消息数和需要移除的消息数
    const totalMessages = allSegments.reduce((sum, seg) => sum + seg.dialogue.length, 0);
    let messagesToRemove = totalMessages - maxMessages;

    if (messagesToRemove <= 0) {
        return newWorldState; // 无需裁剪
    }

    // 5. 按时间戳升序排序片段（从最旧到最新），以便从最旧的开始删除
    allSegments.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // 6. 遍历排序后的片段，从最旧的片段中的最旧消息开始移除
    for (const segment of allSegments) {
        if (messagesToRemove <= 0) break;

        const messagesInSegment = segment.dialogue.length;
        const messagesToDeleteInThisSegment = Math.min(messagesToRemove, messagesInSegment);

        segment.dialogue.splice(0, messagesToDeleteInThisSegment);
        messagesToRemove -= messagesToDeleteInThisSegment;
    }

    // 7. 清理那些因消息被删除而变为空的片段
    newWorldState.channel.history.closed = newWorldState.channel.history.closed.filter(
        (segment) => segment.dialogue.length > 0
    );
    if (newWorldState.channel.history.folded?.dialogue.length === 0) {
        newWorldState.channel.history.folded = undefined;
    }

    // 8. 返回修改后的新 worldState
    return newWorldState;
}
