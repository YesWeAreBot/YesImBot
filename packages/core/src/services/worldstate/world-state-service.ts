import { formatDate, truncate } from "@/shared/utils";
import { Argv, Bot, Context, Element, h, Logger, Query, Random, Service, Session } from "koishi";
import { ChannelDescriptor } from "../../agent";
import { IChatModel, TaskType } from "../model";
import { Services, TableName } from "../types";
import { AgentResponse } from "./agent-response-types";
import { HistoryConfig } from "./config";
import { DialogueSegmentData, MemberData, MessageData } from "./database-models";
import { CommandInvocationPayload } from "./event-types";
import {
    AgentTurn,
    Channel,
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
         * @param segment 更新后的对话片段的完整领域对象
         */
        "worldstate:segment-updated"(session: Session, segment: DialogueSegment): void;
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
 * WorldState 服务
 *
 * 核心职责：
 * 1. 监听和记录所有相关的交互事件（用户消息、指令、AI回复、操作员消息）。
 * 2. 将这些事件组织成结构化的“对话片段”(DialogueSegments)。
 * 3. 管理对话片段的生命周期 (open -> closed -> folded -> summarized -> archived)。
 * 4. 为 Agent 提供一个干净、完整、且经过策略压缩的上下文视图 (WorldState)。
 * 5. 执行后台维护任务，如自动总结和清理旧数据。
 */
export class WorldStateService extends Service<HistoryConfig> {
    // =================================================================================
    // #region 静态属性和依赖注入
    // =================================================================================

    static readonly inject = [Services.Model, Services.Image, Services.Logger];

    // #endregion

    // =================================================================================
    // #region 实例属性
    // =================================================================================

    private _logger: Logger;
    private chatModel: IChatModel;
    private disposers: (() => boolean)[] = [];
    private maintenanceInterval: NodeJS.Timeout;

    /**
     * 用于追踪待定指令的内存状态机。
     * - Key: 频道 ID (`session.channelId`)
     * - Value: 该频道内所有待定指令的数组
     */
    private pendingCommands = new Map<string, PendingCommand[]>();

    // #endregion

    // =================================================================================
    // #region 生命周期方法
    // =================================================================================

    constructor(ctx: Context, config: HistoryConfig) {
        super(ctx, Services.WorldState, true);
        this.ctx = ctx;
        this.config = config;

        this.logger = ctx[Services.Logger].getLogger("[世界状态]");
    }

    /**
     * 服务启动时调用，负责注册数据库模型、监听事件和启动定时任务。
     */
    protected start(): void {
        this.chatModel = this.ctx[Services.Model].useChatGroup(TaskType.Summarization)?.getCurrent();
        if (!this.chatModel) {
            this.logger.warn("⚠️ 未找到任何可用的总结模型，自动总结功能将不可用。");
        }

        this.registerDatabaseModels();
        this.registerEventListeners();
        this.registerCommands();

        this.maintenanceInterval = setInterval(() => {
            this.runMaintenanceTasks();
        }, this.config.advanced.cleanupIntervalMs);

        this.logger.info("🚀 服务已启动");
    }

    /**
     * 服务停止时调用，负责清理所有监听器和定时器。
     */
    protected stop(): void {
        this.disposers.forEach((dispose) => dispose());
        this.disposers = [];
        if (this.maintenanceInterval) {
            clearInterval(this.maintenanceInterval);
        }
        this.logger.info("🛑 服务已停止");
    }

    // #endregion

    // =================================================================================
    // #region 公共 API
    // =================================================================================

    /**
     * 获取指定频道集合的完整世界状态，供 Agent 使用。
     * 此方法是服务对外的核心接口，整合了所有上下文信息并应用了压缩策略。
     *
     * @param allowedChannels 允许 Agent 访问的频道描述符列表。
     * @param onetimeCode 一个一次性代码，用于在 h.transform 中进行特定处理。
     * @returns 一个包含所有活动频道上下文的 `WorldState` 对象。
     */
    public async getWorldState(allowedChannels: ChannelDescriptor[], onetimeCode: string): Promise<WorldState> {
        const activeChannels = await Promise.all(allowedChannels.map((channel) => this.buildFullContextForChannel(channel, onetimeCode)));

        return {
            timestamp: new Date().toISOString(),
            activeChannels: activeChannels,
            inactiveChannels: [], // `inactiveChannels` 的逻辑可以根据未来需求实现
        };
    }

    /**
     * 记录一个 Agent 回合的完整响应，并更新相关对话片段的状态。
     * 这标志着一个交互周期的结束（从用户输入到 Agent 响应）。
     *
     * @param segmentRecord 当前开放的对话片段记录。
     * @param responses Agent 生成的响应列表。
     */
    public async recordAgentTurn(segmentRecord: DialogueSegmentData, responses: AgentResponse[]): Promise<void> {
        const agentTurn: AgentTurn = {
            responses,
            timestamp: new Date(),
        };

        // 将当前片段状态更新为 'closed' 并记录 agentTurn
        await this.ctx.database.set(TableName.DialogueSegments, { id: segmentRecord.id }, { status: SegmentStatus.Closed, agentTurn });
        this.logger.info(`✅ 片段已关闭 | ID: ${segmentRecord.id} | 响应数: ${responses.length}`);

        // 应用上下文折叠策略
        await this.applyFoldingPolicy(segmentRecord.platform, segmentRecord.channelId);
    }

    /**
     * 获取指定频道的当前开放对话片段。如果不存在，则创建一个新的。
     *
     * @param platform 平台名称。
     * @param channelId 频道 ID。
     * @param guildId 服务器（群组）ID，可选。
     * @returns 当前开放的对话片段数据。
     */
    public async getOpenSegment(platform: string, channelId: string, guildId?: string): Promise<DialogueSegmentData> {
        const openSegments = await this.ctx.database
            .select(TableName.DialogueSegments)
            .where({ platform, channelId, status: SegmentStatus.Open })
            .orderBy("timestamp", "desc")
            .limit(1)
            .execute();

        if (openSegments.length > 0) {
            return openSegments[0];
        }

        // 如果没有开放的片段，则创建一个新的
        const newSegment: DialogueSegmentData = {
            id: `seg_${Date.now()}_${Random.id(8)}`,
            platform,
            channelId,
            guildId,
            status: SegmentStatus.Open,
            agentTurn: null,
            timestamp: new Date(),
        };
        await this.ctx.database.create(TableName.DialogueSegments, newSegment);
        this.logger.info(`创建新对话片段 | ID: ${newSegment.id} | 频道: ${platform}:${channelId}`);
        return newSegment;
    }

    /**
     * 将一条消息记录到指定的对话片段中。
     *
     * @param segmentId 目标对话片段的 ID。
     * @param message 包含消息所有必要信息对象。
     */
    public async recordMessage(segmentId: string, message: Omit<MessageData, "sid">): Promise<void> {
        await this.ctx.database.create(TableName.Messages, {
            id: message.id,
            sid: segmentId,
            platform: message.platform,
            channelId: message.channelId,
            sender: message.sender,
            content: message.content,
            timestamp: message.timestamp,
            quoteId: message.quoteId,
        });
        this.logger.debug(`记录新消息 | 消息ID: ${message.id} | 段落ID: ${segmentId}`);
    }

    // #endregion

    // =================================================================================
    // #region 事件处理器与注册
    // =================================================================================

    /**
     * 注册服务所需的所有事件监听器。
     */
    private registerEventListeners(): void {
        // 1. [关键逻辑] 使用前置中间件和事件标志来完美处理用户消息和指令
        this.disposers.push(
            this.ctx.middleware(async (session, next) => {
                // 步骤 1: 检查频道是否允许，如果不允许则直接跳过所有逻辑
                if (!this._isChannelAllowed(session)) {
                    return next();
                }

                // 步骤 2: 无条件记录所有用户发出的消息
                await this._recordUserMessage(session);

                // 步骤 3: 将控制权交给后续中间件（包括指令系统）
                await next();

                // 步骤 4: 在整个处理链结束后，检查指令是否已处理该会话。
                // '__commandHandled' 标志由我们的 'command/before-execute' 监听器设置。
                if (!session["__commandHandled"]) {
                    // 只有当没有指令处理时，才触发 segment-updated
                    const segmentRecord = await this.getOpenSegment(session.platform, session.channelId, session.guildId);
                    const dialogueSegment = await this.buildDialogueSegment(segmentRecord, "");
                    this.ctx.emit("worldstate:segment-updated", session, dialogueSegment);
                }
            }, true) // <-- true (prepend) 是此模式成功的关键
        );

        // 2. 指令调用事件：除了记录事件，现在还负责设置标志
        this.disposers.push(
            this.ctx.on("command/before-execute", (argv) => {
                // 设置标志，通知中间件此会话已被指令接管
                argv.session["__commandHandled"] = true;
                this.logger.debug(`指令已接管，将抑制Agent响应 | 指令: ${argv.command.name}`);

                // 仍然调用原始处理器来记录系统事件
                this.handleCommandInvocation(argv);
            })
        );

        // 3. 机器人消息处理（保持不变）
        this.disposers.push(this.ctx.on("before-send", (session) => this._matchCommandResult(session), true));
        this.disposers.push(this.ctx.on("after-send", (session) => this._recordBotSentMessage(session), true));

        // 4. 操作员手动消息（保持不变）
        this.disposers.push(
            this.ctx.on("message", (session) => {
                if (session.userId === session.bot.selfId && !session.scope) {
                    this.handleOperatorMessage(session);
                }
            })
        );
    }

    /**
     * 注册服务的 CLI 指令。
     */
    private registerCommands(): void {
        this.ctx.command("history.summarize", "手动触发当前频道的历史记录总结", { authority: 3 }).action(async ({ session }) => {
            try {
                await this.summarizeAndArchive(session.platform, session.channelId);
                return "✅ 手动总结任务已触发并完成。";
            } catch (error) {
                this.logger.error(error, "❌ 手动总结任务失败");
                return "❌ 总结任务失败，请检查日志。";
            }
        });

        this.ctx
            .command("history.clear", "清除指定频道的历史记录", { authority: 3 })
            .option("all", "-a <type:string> 清理全部指定类型的频道 (private, guild, all)", { authority: 3 })
            .option("platform", "-p <platform:string> 指定平台", { authority: 3 })
            .option("channel", "-c <channel:string> 指定频道ID (多个用逗号分隔)", { authority: 3 })
            .option("target", "-t <target:string> 指定目标 'platform:channelId' (多个用逗号分隔)", { authority: 3 })
            .option("delete", "--delete 永久删除记录(包括关联消息)，而非归档", { authority: 3, type: "boolean" })
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
                            } else {
                                // 归档模式：只更新对话片段的状态
                                await db.set(TableName.DialogueSegments, query, { status: SegmentStatus.Archived });
                            }
                        });

                        const recordCount = segmentsToClear.length;
                        results.push(`✅ ${description} - ${recordCount} 条对话片段已${actionPastTense}。`);
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
                            const dialogues = await this.ctx.database.get(TableName.DialogueSegments, { channelId }, ["platform"]);
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
                    return `操作已中止。存在需要明确指定的频道：\n${ambiguousChannels.join(
                        "\n"
                    )}\n请使用 -p <platform> 或 -t <platform:channelId> 来指定。`;
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

    /**
     * 处理操作员（使用机器人账号手动发送）的消息。
     * @param session 消息会话对象。
     */
    private async handleOperatorMessage(session: Session): Promise<void> {
        if (!this._isChannelAllowed(session)) {
            return;
        }
        this.logger.info(`捕获到操作员消息 | 操作员: ${session.author.name} | 频道: ${session.cid}`);
        await this._recordMessageAndUpdateSegment(session, false);
    }

    /**
     * 处理指令调用事件，记录为系统事件。
     * @param argv 指令的参数对象。
     */
    private async handleCommandInvocation(argv: Argv): Promise<void> {
        const { session, command, args, options, source } = argv;
        if (!session) return;

        this.logger.debug(`记录指令调用事件: ${command.name}`);

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

        // 在内存中创建待定状态，用于匹配指令结果
        if (!this.pendingCommands.has(session.channelId)) {
            this.pendingCommands.set(session.channelId, []);
        }
        this.pendingCommands.get(session.channelId).push({
            commandEventId,
            scope: session.scope,
            invokerId: session.userId,
            timestamp: Date.now(),
        });
    }

    // #endregion

    // =================================================================================
    // #region 私有辅助方法
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
     * 检查一个会话所在的频道是否被允许记录。
     * @param session 会话对象
     * @returns 是否允许
     */
    private _isChannelAllowed(session: Session): boolean {
        const cid = session.cid;
        const platform = session.platform;
        const allowed = this.config.allowedChannels;

        return allowed.has(cid) || allowed.has("*:*") || allowed.has(`${platform}:*`) || allowed.has(`${platform}:all`);
    }

    /**
     * 统一处理用户和操作员消息的记录与通知流程。
     * @param session 消息会话。
     * @param isCommand 是否是指令消息，指令消息不触发 segment-updated 事件，避免 agent 响应。
     */
    private async _recordMessageAndUpdateSegment(session: Session, isCommand: boolean): Promise<void> {
        const segmentRecord = await this.getOpenSegment(session.platform, session.channelId, session.guildId);

        if (session.guildId) {
            await this._updateMemberInfo(session);
        }

        const transformedContent = await h
            .transformAsync(session.elements, async (element) => {
                if (element.type === "img" || element.type === "image") {
                    return this.ctx[Services.Image].processImageElement(element, session);
                }
                return element;
            })
            .then((res) => res.join(""));

        // 使用原始 messageId
        await this.recordMessage(segmentRecord.id, {
            id: session.messageId,
            platform: session.platform,
            channelId: session.channelId,
            sender: {
                id: session.userId,
                name: session.author.nick || session.author.name,
                roles: session.author.roles,
            },
            content: transformedContent,
            timestamp: new Date(session.timestamp),
            quoteId: session.quote?.id,
        });

        // 只有非指令的纯消息才触发 segment-updated 事件，以供 Agent 响应。
        // 指令有自己的响应流程，不应触发此事件。
        if (!isCommand) {
            const dialogueSegment = await this.buildDialogueSegment(segmentRecord, "");
            this.ctx.emit("worldstate:segment-updated", session, dialogueSegment);
        }
    }

    /**
     * 更新或插入成员信息到数据库。
     * @param session 包含作者信息的消息会话。
     */
    private async _updateMemberInfo(session: Session): Promise<void> {
        if (!session.guildId || !session.author) return;

        await this.ctx.database.upsert(TableName.Members, [
            {
                pid: session.userId,
                platform: session.platform,
                guildId: session.guildId,
                name: session.author.nick || session.author.name,
                roles: session.author.roles,
                avatar: session.author.avatar,
                lastActive: new Date(),
            },
        ]);
    }

    /**
     * 尝试将一条程序化消息与一个待定的指令进行匹配，并更新事件记录。
     * @param session 带有 scope 的消息会话。
     * @returns 如果匹配并处理成功，返回 true，否则 false。
     */
    private async _tryMatchAndRecordCommandResult(session: Session): Promise<boolean> {
        const pendingInChannel = this.pendingCommands.get(session.channelId);
        if (!pendingInChannel || pendingInChannel.length === 0) return false;

        // 从后往前找，因为最新的调用最可能先被回复。
        // 精确匹配 scope 和调用者 ID，避免多用户并发指令时混淆
        const pendingIndex = pendingInChannel.findIndex((p) => p.scope === session.scope && p.invokerId === session.userId);

        if (pendingIndex !== -1) {
            const [pendingCmd] = pendingInChannel.splice(pendingIndex, 1);
            this.logger.debug(`✅ 匹配到指令结果 | 事件ID: ${pendingCmd.commandEventId}`);

            // 更新数据库中的指令事件，加入 result 字段
            const existingEvent = await this.ctx.database.get(TableName.SystemEvents, { id: pendingCmd.commandEventId });
            if (existingEvent.length > 0) {
                const updatedPayload: CommandInvocationPayload = {
                    ...existingEvent[0].payload,
                    result: session.content,
                } as CommandInvocationPayload;
                await this.ctx.database.set(TableName.SystemEvents, { id: pendingCmd.commandEventId }, { payload: updatedPayload });
            }

            return true;
        }
        return false;
    }

    /**
     * 为单个频道构建完整的上下文信息。
     * 这是一个分发器，根据频道ID的格式决定是构建公会频道还是私聊频道的上下文。
     * @param channel 频道描述符，包含平台和频道ID。
     * @param onetimeCode 一次性代码。
     * @returns 一个完整的 `Channel` 对象。
     */
    private async buildFullContextForChannel(channel: ChannelDescriptor, onetimeCode: string): Promise<Channel> {
        const { platform, id } = channel;
        const bot = this.ctx.bots.find((b) => b.platform === platform && b.isActive);

        if (!bot) {
            this._logger.warn(`Could not find an online bot for platform "${platform}" to build channel context.`);
            // 在没有可用 bot 的情况下，返回一个最基础的表示
            return {
                id,
                platform,
                name: `Offline Channel ${id}`,
                type: id.startsWith("private:") ? "private" : "unknown",
                meta: {},
                members: [],
                history: {
                    pending: [],
                },
            };
        }

        if (id.startsWith("private:")) {
            return this._buildPrivateChannelContext(bot, channel, onetimeCode);
        } else {
            return this._buildGuildChannelContext(bot, channel, onetimeCode);
        }
    }

    /**
     * 在消息发送前，仅用于匹配待处理的指令结果并更新 SystemEvent。
     * 它不记录消息本身，因为此时 messageId 可能尚不存在。
     * @param session 即将发送消息的会话对象。
     */
    private async _matchCommandResult(session: Session): Promise<void> {
        if (!session.scope) return; // 只关心有 scope 的会话，它们是指令回复的候选

        const pendingInChannel = this.pendingCommands.get(session.channelId);
        if (!pendingInChannel || pendingInChannel.length === 0) return;

        const pendingIndex = pendingInChannel.findIndex((p) => p.scope === session.scope && p.invokerId === session.userId);

        if (pendingIndex !== -1) {
            const [pendingCmd] = pendingInChannel.splice(pendingIndex, 1);
            this.logger.debug(`✅ 匹配到指令结果 | 事件ID: ${pendingCmd.commandEventId}`);

            const existingEvent = await this.ctx.database.get(TableName.SystemEvents, { id: pendingCmd.commandEventId });
            if (existingEvent.length > 0) {
                const updatedPayload: CommandInvocationPayload = {
                    ...existingEvent[0].payload,
                    result: session.content,
                } as CommandInvocationPayload;
                await this.ctx.database.set(TableName.SystemEvents, { id: pendingCmd.commandEventId }, { payload: updatedPayload });
            }
        }
    }

    /**
     * [重构] 此方法现在仅负责记录用户消息，不再处理事件触发逻辑。
     * @param session 消息会话。
     */
    private async _recordUserMessage(session: Session): Promise<void> {
        this.logger.info(`捕获到用户消息 | 用户: ${session.author.name} | 内容: ${truncate(session.content).replace(/\n/g, " ")}`);

        const segmentRecord = await this.getOpenSegment(session.platform, session.channelId, session.guildId);

        if (session.guildId) {
            await this._updateMemberInfo(session);
        }

        const transformedContent = await h
            .transformAsync(session.elements, async (element) => {
                if (element.type === "img" || element.type === "image") {
                    return this.ctx[Services.Image].processImageElement(element, session);
                }
                return element;
            })
            .then((res) => res.join(""));

        await this.recordMessage(segmentRecord.id, {
            id: session.messageId,
            platform: session.platform,
            channelId: session.channelId,
            sender: {
                id: session.userId,
                name: session.author.nick || session.author.name,
                roles: session.author.roles,
            },
            content: transformedContent,
            timestamp: new Date(session.timestamp),
            quoteId: session.quote?.id,
        });
    }

    /**
     * 在消息发送后，统一记录所有机器人发送的消息。
     * 此时 session.messageId 是确定的。
     * @param session 已发送消息的会话对象。
     */
    private async _recordBotSentMessage(session: Session): Promise<void> {
        // 确保消息有内容和ID才记录
        if (!session.content || !session.messageId) return;

        this.logger.debug(`记录已发送的AI消息 | 频道: ${session.cid} | 消息ID: ${session.messageId}`);

        const openSegment = await this.getOpenSegment(session.platform, session.channelId, session.guildId);
        if (!openSegment) return;

        // 使用来自 after-send 的、确定的 messageId
        await this.recordMessage(openSegment.id, {
            id: session.messageId,
            platform: session.platform,
            channelId: session.channelId,
            sender: { id: session.bot.selfId, name: session.bot.user.nick || session.bot.user.name },
            content: session.content,
            timestamp: new Date(), // 使用当前时间作为发送时间
        });
    }

    /**
     * 构建私聊频道的上下文。
     * @param bot 可用的机器人实例。
     * @param channel 频道描述符。
     * @param onetimeCode 一次性代码。
     * @returns 一个私聊频道的 `Channel` 对象。
     */
    private async _buildPrivateChannelContext(bot: Bot, channel: ChannelDescriptor, onetimeCode: string): Promise<Channel> {
        const { platform, id } = channel;
        const userId = id.substring("private:".length);

        // 并行获取对方用户信息和会话历史
        const [user, history] = await Promise.all([
            bot.getUser(userId).catch((e) => {
                this._logger.error(`Failed to get user info for ${platform}:${userId}`, e);
                return null; // 容错处理
            }),
            this._fetchAndBuildHistory(channel, onetimeCode),
        ]);

        const userName = user?.name || user?.nick || userId;

        const botAsMember: GuildMember = {
            pid: bot.selfId,
            name: bot.user.name,
            nick: bot.user.nick || bot.user.name,
            roles: ["assistant", "bot"],
            isSelf: true,
        };

        const userAsMember: GuildMember = {
            pid: userId,
            name: userName,
            nick: user?.nick || userName,
            roles: ["user"],
            isSelf: false,
        };

        return {
            id,
            platform,
            name: `与 ${userName} 的私聊`,
            type: "private",
            meta: {},
            members: [botAsMember, userAsMember],
            history,
        };
    }

    /**
     * 构建公会频道的上下文。
     * @param bot 可用的机器人实例。
     * @param channel 频道描述符。
     * @param onetimeCode 一次性代码。
     * @returns 一个公会频道的 `Channel` 对象。
     */
    private async _buildGuildChannelContext(bot: Bot, channel: ChannelDescriptor, onetimeCode: string): Promise<Channel> {
        const { platform, id } = channel;

        // 并行获取频道信息和会话历史
        const [channelInfo, history] = await Promise.all([
            bot.getChannel(id).catch((e) => {
                return null;
            }),
            this._fetchAndBuildHistory(channel, onetimeCode),
        ]);

        if (!channelInfo) {
            this._logger.warn(`获取频道信息失败，将返回一个基础对象 | 频道: ${platform}:${id}`);
            return {
                id,
                platform,
                name: `Channel ${id}`,
                type: "guild",
                meta: {},
                members: [],
                history,
            };
        }

        const members = await this._getMembersFromHistory(bot, history, platform, id);

        return {
            id,
            platform,
            name: channelInfo.name,
            type: "guild", // 此处可根据 channelInfo.type 进一步细化
            meta: { ...channelInfo }, // 存储完整的频道元数据
            members,
            history,
        };
    }

    /**
     * 从数据库获取并构建完整的对话历史记录。
     * @param channel 频道描述符。
     * @param onetimeCode 一次性代码。
     * @returns 对话片段数组。
     */
    private async _fetchAndBuildHistory(
        channel: ChannelDescriptor,
        onetimeCode: string
    ): Promise<{ pending: DialogueSegment[]; folded: FoldedDialogueSegment; summarized: SummarizedDialogueSegment[] }> {
        const pendingSegments = await this.ctx.database
            .select(TableName.DialogueSegments)
            .where({ platform: channel.platform, channelId: channel.id })
            .where({ status: { $ne: "archived" } })
            .where({ status: { $ne: "folded" } })
            .where({ status: { $ne: "summarized" } })
            .orderBy("timestamp", "desc")
            .limit(this.config.fullContextSegmentCount)
            .execute()
            .then((res) => res.reverse());

        const foldedSegments = await this.ctx.database
            .select(TableName.DialogueSegments)
            .where({ platform: channel.platform, channelId: channel.id })
            .where({ status: "folded" })
            .orderBy("timestamp", "desc")
            .limit(this.config.summarizationTriggerCount)
            .execute()
            .then((res) => res.reverse());

        const summarizedSegments = await this.ctx.database
            .select(TableName.DialogueSegments)
            .where({ platform: channel.platform, channelId: channel.id })
            .where({ status: "summarized" })
            .orderBy("timestamp", "desc")
            .limit(
                this.config.advanced.maxHistoryItemsPerChannel - this.config.fullContextSegmentCount - this.config.summarizationTriggerCount
            )
            .execute()
            .then((res) => res.reverse());

        const pending = await Promise.all(pendingSegments.map((record) => this.buildDialogueSegment(record, onetimeCode)));
        const folded = foldedSegments.length > 0 ? await this.buildFoldedDialogueSegment(foldedSegments, onetimeCode) : undefined;
        const summarized = await Promise.all(summarizedSegments.map((record) => this.buildSummarizedDialogueSegment(record, onetimeCode)));

        return { pending, folded, summarized };
    }

    private async buildSummarizedDialogueSegment(record: DialogueSegmentData, onetimeCode: string): Promise<SummarizedDialogueSegment> {
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
    /**
     * 被折叠的对话片段集合
     *
     * 将多个折叠片段消息合并在一起，并剔除助手回合
     * @param foldedSegments
     * @param onetimeCode
     */
    async buildFoldedDialogueSegment(foldedSegments: DialogueSegmentData[], onetimeCode: string): Promise<FoldedDialogueSegment> {
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
            dialogue: this.buildDialogueMessages(allMessages, onetimeCode),
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
     * 根据历史记录获取相关成员列表，并注入机器人自身。
     * @param bot 机器人实例。
     * @param history 对话历史。
     * @param platform 平台。
     * @param guildId 公会ID。
     * @returns 成员列表。
     */
    private async _getMembersFromHistory(bot: Bot, history: History, platform: string, guildId: string): Promise<GuildMember[]> {
        const memberIds = new Set<string>();

        history.pending.forEach((segment) => {
            segment.dialogue.forEach((message) => {
                memberIds.add(message.sender.id);
            });
        });

        if (history.folded) {
            history.folded.dialogue.forEach((message) => {
                memberIds.add(message.sender.id);
            });
        }

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

    private buildDialogueMessages(messageRecords: MessageData[], onetimeCode: string): ContextualMessage[] {
        const quotedMsgIds = new Set(messageRecords.filter((m) => m.quoteId).map((m) => m.quoteId));

        function transform(source: string) {
            const warp = (element: Element, onecode: string) => {
                element.attrs.onetime_code = onecode;
                return element;
            };
            return h.transform(source, (element) => {
                switch (element.type) {
                    case "text":
                        return h.text(element.attrs.content);
                    default:
                        return warp(element, onetimeCode);
                }
            });
        }

        return messageRecords.map((record) => ({
            id: record.id,
            content: transform(record.content),
            timestamp: record.timestamp,
            date: formatDate(record.timestamp, "YYYY-MM-DD"),
            time: formatDate(record.timestamp, "HH:mm:ss"),
            quoted: quotedMsgIds.has(record.id),
            quoteId: record.quoteId,
            sender: { id: record.sender.id, name: record.sender.name, roles: record.sender.roles },
        }));
    }

    /**
     * 根据数据库记录和其状态，高效地构建完整的 `DialogueSegment` 对象。
     * 这是实现上下文策略（如只显示总结内容）的核心。
     * @param segmentRecord 从数据库获取的对话片段原始数据。
     * @param existingHistory 可选，如果已获取，直接传入以避免重复查询。
     * @returns 一个完整的、可供 Agent 使用的 `DialogueSegment` 对象。
     */
    public async buildDialogueSegment(segmentRecord: DialogueSegmentData, onetimeCode: string): Promise<DialogueSegment> {
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

        dialogueSegment.dialogue = this.buildDialogueMessages(messageRecords, onetimeCode);

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
     * 应用上下文折叠策略：如果 `closed` 状态的片段数量超过阈值，则将最旧的片段标记为 `folded`。
     */
    private async applyFoldingPolicy(platform: string, channelId: string): Promise<void> {
        const closedSegments = await this.ctx.database.get(TableName.DialogueSegments, {
            channelId,
            platform,
            status: SegmentStatus.Closed,
        });

        if (closedSegments.length > this.config.fullContextSegmentCount) {
            const segmentsToFold = closedSegments
                .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                .slice(0, closedSegments.length - this.config.fullContextSegmentCount);

            const idsToFold = segmentsToFold.map((s) => s.id);
            if (idsToFold.length > 0) {
                await this.ctx.database.set(TableName.DialogueSegments, { id: { $in: idsToFold } }, { status: SegmentStatus.Folded });
                this.logger.info(`折叠了 ${idsToFold.length} 个旧片段 | 频道: ${platform}:${channelId}`);
            }
        }
    }

    // #endregion

    // =================================================================================
    // #region 后台维护任务
    // =================================================================================

    /**
     * 运行周期性维护任务。
     */
    private runMaintenanceTasks(): void {
        this.logger.debug("开始执行后台维护任务...");
        this._cleanupPendingCommands();

        if (this.config.enableSummarization && this.chatModel) {
            this.triggerSummarizationForEligibleChannels().catch((error) => {
                this.logger.error(error, "❌ 自动总结任务执行失败");
            });
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
            this.logger.debug(`清理了 ${cleanedCount} 个过期待定指令。`);
        }
    }

    /**
     * 查找并触发符合总结条件的频道的总结归档流程。
     */
    private async triggerSummarizationForEligibleChannels(): Promise<void> {
        const channelsToSummarize = await this._findChannelsWithSufficientFoldedSegments();
        if (channelsToSummarize.length > 0) {
            this.logger.info(`发现 ${channelsToSummarize.length} 个频道符合总结条件。`);
            for (const channel of channelsToSummarize) {
                await this.summarizeAndArchive(channel.platform, channel.channelId);
            }
        }
    }

    /**
     * 查找哪些频道有足够多的 'folded' 片段以触发总结。
     * @returns 需要总结的频道列表。
     */
    private async _findChannelsWithSufficientFoldedSegments(): Promise<{ platform: string; channelId: string }[]> {
        // 优化：未来如果数据量巨大，可以考虑使用数据库聚合查询
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
                channelsToProcess.push(channelMetas.get(key)!);
            }
        }
        return channelsToProcess;
    }

    /**
     * 对指定频道的 'folded' 片段进行总结和归档。
     * @param platform 平台名称。
     * @param channelId 频道 ID。
     */
    private async summarizeAndArchive(platform: string, channelId: string): Promise<void> {
        this.logger.info(`开始总结频道: ${platform}:${channelId}`);
        const foldedSegments = await this.ctx.database
            .get(TableName.DialogueSegments, { platform, channelId, status: SegmentStatus.Folded })
            .then((res) => res.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()));

        if (foldedSegments.length < this.config.summarizationTriggerCount) return;

        const groupIds = foldedSegments.map((s) => s.id);
        const latestTimestamp = foldedSegments[foldedSegments.length - 1].timestamp;

        // 生成对话文本并调用模型进行总结
        const dialogueText = await this.renderSegmentsToText(foldedSegments);
        if (!dialogueText) {
            this.logger.warn(`无法为频道 ${channelId} 生成对话文本，跳过总结。`);
            return;
        }

        const prompt = this.config.summarizationPrompt.replace("{dialogueText}", dialogueText);
        const summaryResponse = await this.chatModel.chat([{ role: "user", content: prompt }]).catch((e) => {
            this.logger.error(e, `总结模型调用失败 | 频道: ${channelId}`);
            return null;
        });
        const summaryText = summaryResponse?.text;

        if (!summaryText) {
            this.logger.warn(`模型未返回有效的总结内容，将直接归档片段 | 频道: ${channelId}`);
            // 即使总结失败，也标记为已归档，避免阻塞流程
            await this.ctx.database.set(TableName.DialogueSegments, { id: { $in: groupIds } }, { status: SegmentStatus.Archived });
            return;
        }

        // 创建新的总结片段
        const summarySegment: DialogueSegmentData = {
            id: `sum_${Date.now()}_${Random.id(8)}`,
            platform: platform,
            channelId: channelId,
            guildId: foldedSegments[0].guildId,
            status: SegmentStatus.Summarized,
            summary: summaryText,
            timestamp: latestTimestamp,
            agentTurn: null,
        };

        // 在一个事务中创建总结片段并归档旧片段，确保数据一致性
        await this.ctx.database.withTransaction(async (db) => {
            await db.create(TableName.DialogueSegments, summarySegment);
            await db.set(TableName.DialogueSegments, { id: { $in: groupIds } }, { status: SegmentStatus.Archived });
        });

        this.logger.info(`成功总结 ${groupIds.length} 个片段 | 频道: ${channelId} | 新总结ID: ${summarySegment.id}`);
    }

    /**
     * 将一组对话片段渲染为纯文本，用于总结。
     * @param segments 一组需要被渲染为文本的对话片段数据。
     * @returns 格式化后的完整对话历史字符串。
     */
    private async renderSegmentsToText(segments: DialogueSegmentData[]): Promise<string> {
        if (!segments || segments.length === 0) return "";

        const segmentIds = segments.map((segment) => segment.id);

        // 1. 一次性获取所有相关消息并排序
        const allMessages = await this.ctx.database.get(TableName.Messages, {
            sid: { $in: segmentIds },
        });
        allMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        if (allMessages.length === 0) return "";

        // 2. 收集所有唯一的发送者ID
        const senderIds = [...new Set(allMessages.map((msg) => msg.sender.id))];

        // 3. 一次性获取所有相关的成员信息
        const membersData = await this.ctx.database.get(TableName.Members, {
            platform: segments[0].platform, // 假设所有片段都在同一平台
            pid: { $in: senderIds },
        });

        // 4. 将成员信息存入 Map 以便快速查找
        const membersMap = new Map<string, MemberData>();
        membersData.forEach((member) => membersMap.set(member.pid, member));

        // 5. 格式化为文本
        const dialogueLines = allMessages
            .map((msg) => {
                const member = membersMap.get(msg.sender.id);
                const senderName = member?.name || msg.sender.name || msg.sender.id;
                const timestampStr = formatDate(msg.timestamp);

                // 将 h 元素转换为纯文本
                const contentText = h
                    .parse(msg.content)
                    .map((el) => el.toString())
                    .join("")
                    .trim();
                if (!contentText) return null; // 忽略空内容消息

                return `[${timestampStr}] ${senderName}: ${contentText}`;
            })
            .filter(Boolean); // 过滤掉空行

        return dialogueLines.join("\n");
    }

    // #endregion
}
