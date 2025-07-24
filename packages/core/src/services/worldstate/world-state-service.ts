import { Argv, Context, Element, h, Logger, Query, Random, Service, Session } from "koishi";

import { IEmbedModel, TaskType } from "@/services/model";
import { Services, TableName } from "@/services/types";
import { truncate } from "@/shared/utils";
import { HistoryConfig } from "./config";
import { ContextBuilder } from "./context-builder";
import { DialogueSegmentData, MessageData } from "./database-models";
import { CommandInvocationPayload } from "./event-types";
import { AgentResponse, ContextualMessage, WorldState } from "./interfaces";
import { DialogueSegmentManager } from "./segment-manager";
import { SummarizationManager } from "./summarize";
import { pruneHistoryByMessages } from "./utils";

// 扩展 Koishi 的 Context 和 Events 接口
declare module "koishi" {
    interface Context {
        [Services.WorldState]: WorldStateService;
    }
    interface Events {
        "worldstate:segment-updated"(session: Session, sid: string): void;
        "worldstate:summary"(summaryChunk: {
            self: { id: string; name: string };
            platform: string;
            contextId: string;
            dialogue: ContextualMessage[];
        }): void;
    }
}

interface PendingCommand {
    commandEventId: string;
    scope: string;
    invokerId: string;
    timestamp: number;
}

// =================================================================================
// #region EventListenerManager - 负责所有事件监听与处理
// =================================================================================
class EventListenerManager {
    private readonly disposers: (() => boolean)[] = [];
    private readonly pendingCommands = new Map<string, PendingCommand[]>();
    private _logger: Logger;

    constructor(private ctx: Context, private service: WorldStateService, private config: HistoryConfig) {
        this._logger = ctx[Services.Logger].getLogger("[世界状态]");
    }

    public start(): void {
        this.registerEventListeners();
    }

    public stop(): void {
        this.disposers.forEach((dispose) => dispose());
        this.disposers.length = 0;
    }

    public cleanupPendingCommands(): void {
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
            this._logger.debug(`清理了 ${cleanedCount} 个过期待定指令`);
        }
    }

    private registerEventListeners(): void {
        this.disposers.push(
            this.ctx.middleware(async (session, next) => {
                if (!this.service.isChannelAllowed(session)) {
                    return next();
                }

                await this.recordUserMessage(session);
                await next();

                if (!session["__commandHandled"]) {
                    const segmentRecord = await this.service.getOpenSegment(
                        session.platform,
                        session.channelId,
                        session.guildId
                    );
                    this.ctx.emit("worldstate:segment-updated", session, segmentRecord.id);
                }
            })
        );

        this.disposers.push(
            this.ctx.on("command/before-execute", (argv) => {
                argv.session["__commandHandled"] = true;
                this.handleCommandInvocation(argv);
            })
        );

        this.disposers.push(this.ctx.on("before-send", (session) => this.matchCommandResult(session), true));
        this.disposers.push(this.ctx.on("after-send", (session) => this.recordBotSentMessage(session), true));

        this.disposers.push(
            this.ctx.on("message", (session) => {
                if (session.userId === session.bot.selfId && !session.scope) {
                    this.handleOperatorMessage(session);
                }
            })
        );
    }

    private async handleOperatorMessage(session: Session): Promise<void> {
        if (!this.service.isChannelAllowed(session)) return;

        this._logger.info(`捕获操作员消息 | 操作员: ${session.author.name} | 频道: ${session.cid}`);
        const segment = await this.service.getOpenSegment(session.platform, session.channelId, session.guildId);
        await this.recordBotSentMessage(session, segment.id);
    }

    private async handleCommandInvocation(argv: Argv): Promise<void> {
        const { session, command, source } = argv;
        if (!session) return;

        this._logger.info(`捕获指令调用 | 用户: ${session.author.name} | 指令: ${command.name} | 频道: ${session.cid}`);

        const segmentRecord = await this.service.getOpenSegment(session.platform, session.channelId, session.guildId);
        const commandEventId = `cmd_invoked_${session.messageId || Random.id()}`;

        const eventPayload: CommandInvocationPayload = {
            name: command.name,
            source,
            invoker: { pid: session.userId, name: session.author.nick || session.author.name },
        };

        await this.ctx.database.create(TableName.SystemEvents, {
            id: commandEventId,
            sid: segmentRecord.id,
            type: "command-invoked",
            timestamp: new Date(),
            payload: eventPayload,
        });

        const pendingList = this.pendingCommands.get(session.channelId) || [];
        pendingList.push({
            commandEventId,
            scope: session.scope,
            invokerId: session.userId,
            timestamp: Date.now(),
        });
        this.pendingCommands.set(session.channelId, pendingList);
    }

    private async matchCommandResult(session: Session): Promise<void> {
        if (!session.scope) return;

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

    private async recordUserMessage(session: Session): Promise<void> {
        /* prettier-ignore */
        this._logger.info( `用户消息 | ${session.author.name} | 频道: ${session.cid} | 内容: ${truncate(session.content).replace(/\n/g, " ")}`);

        const segment = await this.service.getOpenSegment(session.platform, session.channelId, session.guildId);
        if (session.guildId) {
            await this.updateMemberInfo(session);
        }

        const content = await this.service.transformMessageContent(session.elements, session);
        this._logger.debug(`记录转义后的消息：${content}`);
        await this.service.recordMessage(segment.id, {
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

    private async recordBotSentMessage(session: Session, segmentId?: string): Promise<void> {
        if (!session.content || !session.messageId) return;

        this._logger.debug(`记录机器人消息 | 频道: ${session.cid} | 消息ID: ${session.messageId}`);
        const sid =
            segmentId || (await this.service.getOpenSegment(session.platform, session.channelId, session.guildId)).id;

        await this.service.recordMessage(sid, {
            id: session.messageId,
            platform: session.platform,
            channelId: session.channelId,
            sender: { id: session.bot.selfId, name: session.bot.user.nick || session.bot.user.name },
            content: session.content,
            timestamp: new Date(),
        });
    }

    private async updateMemberInfo(session: Session): Promise<void> {
        if (!session.guildId || !session.author) return;

        try {
            const memberKey = { pid: session.userId, platform: session.platform, guildId: session.guildId };
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
                await this.ctx.database.create(TableName.Members, { ...memberKey, ...memberData });
            }
        } catch (error) {
            this._logger.error(`更新成员信息失败: ${error.message}`);
        }
    }
}
// #endregion

// =================================================================================
// #region HistoryCommandManager - 负责所有CLI指令
// =================================================================================
class HistoryCommandManager {
    private _logger: Logger;

    constructor(private ctx: Context, private service: WorldStateService, private config: HistoryConfig) {
        this._logger = ctx[Services.Logger].getLogger("[世界状态.指令]");
    }

    public register(): void {
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
                        return `❌❌ 格式错误的目标: "${options.target}"，已跳过`;
                    }
                    platform = parts[0];
                    channelId = parts.slice(1).join(":");
                }

                if (channelId) {
                    if (!platform) {
                        const dialogues = await this.ctx.database.get(TableName.DialogueSegments, { channelId }, [
                            "platform",
                        ]);
                        const platforms = [...new Set(dialogues.map((d) => d.platform))];

                        if (platforms.length === 0) return `🟡🟡🟡 频道 "${channelId}" 未找到任何历史记录，已跳过`;
                        if (platforms.length === 1) platform = platforms[0];
                        else
                            /* prettier-ignore */
                            return `❌❌ 频道 "${channelId}" 存在于多个平台: ${platforms.join(", ")}请使用 -p <platform> 来指定`;
                    }
                }

                const segments = await this.ctx.database.get(TableName.DialogueSegments, {
                    platform,
                    channelId,
                    status: { $ne: "archived" },
                });
                const allMessages = await this.ctx.database.get(TableName.Messages, {
                    sid: { $in: segments.map((s) => s.id) },
                });

                /* prettier-ignore */
                return `在 ${platform}:${channelId} 中有 ${allMessages.length} 条待处理的消息${allMessages.length > this.config.maxMessages ? `，实际激活 ${this.config.maxMessages} 条` : ""}`;
            });

        historyCmd.subcommand(".summarize", "手动触发当前频道的历史记录总结").action(async ({ session }) => {
            try {
                await this.service.summarizationManager.summarizeAndArchive(session.platform, session.channelId);
                return "✅ 手动总结任务已触发并完成";
            } catch (error) {
                this._logger.error(error, `[指令] 手动总结任务失败 | 频道: ${session.cid}`);
                return "❌❌ 总结任务失败，请检查日志";
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
                `清除历史记录上下文
默认操作是将消息标记为"已归档"，数据仍保留在数据库中
使用 --delete 选项会从数据库中永久移除相关对话、消息和系统事件，此操作不可恢复

当单独使用 -c 指定的频道ID存在于多个平台时，指令会要求您使用 -p 或 -t 来明确指定平台`
            )
            .example(
                [
                    "",
                    "history.clear                      # 清除当前频道的历史记录",
                    "history.clear -c 12345678          # 清除频道 12345678 的历史记录",
                    "history.clear -a private           # 归档所有私聊频道的历史记录",
                    "history.clear -a guild --delete    # 永久删除所有群聊对话及关联消息",
                ].join("\n")
            )
            .action(async ({ session, options }) => {
                const isDelete = !!options.delete;
                const actionPastTense = isDelete ? "永久删除" : "归档";
                const results: string[] = [];

                const performClear = async (query: Query<DialogueSegmentData>, description: string) => {
                    try {
                        const segmentsToClear = await this.ctx.database.get(TableName.DialogueSegments, query, ["id"]);
                        if (segmentsToClear.length === 0) {
                            results.push(`🟡🟡🟡 ${description} - 未找到匹配的历史记录`);
                            return;
                        }
                        const segmentIds = segmentsToClear.map((s) => s.id);

                        await this.ctx.database.transact(async (db) => {
                            if (isDelete) {
                                await db.remove(TableName.Messages, { sid: { $in: segmentIds } });
                                await db.remove(TableName.SystemEvents, { sid: { $in: segmentIds } });
                                await db.remove(TableName.DialogueSegments, { id: { $in: segmentIds } });
                                /* prettier-ignore */
                                results.push(`✅ ${description} - ${segmentsToClear.length} 条对话片段已${actionPastTense}`);
                            } else {
                                const writeResult = await db.set(
                                    TableName.DialogueSegments,
                                    { ...(query as any), status: { $ne: "archived" } },
                                    { status: "archived" }
                                );
                                /* prettier-ignore */
                                results.push(`✅ ${description} - ${writeResult.modified || writeResult.matched || 0} 条对话片段已${actionPastTense}`);
                            }
                        });
                    } catch (error) {
                        this.ctx.logger.warn(`为 ${description} 清理历史记录时失败:`, error);
                        results.push(`❌❌ ${description} - 操作失败，数据库更改已回滚`);
                    }
                };

                if (options.all) {
                    if (options.all === undefined)
                        return "错误：-a 的参数必须是 'private', 'guild', 或 'all'";
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

                const targetsToProcess: { platform: string; channelId: string }[] = [];
                const ambiguousChannels: string[] = [];

                if (options.target) {
                    for (const target of options.target
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean)) {
                        const parts = target.split(":");
                        if (parts.length < 2) {
                            results.push(`❌❌ 格式错误的目标: "${target}"`);
                            continue;
                        }
                        targetsToProcess.push({ platform: parts[0], channelId: parts.slice(1).join(":") });
                    }
                }

                if (options.channel) {
                    for (const channelId of options.channel
                        .split(",")
                        .map((c) => c.trim())
                        .filter(Boolean)) {
                        if (options.platform) {
                            targetsToProcess.push({ platform: options.platform, channelId });
                        } else {
                            const dialogues = await this.ctx.database.get(TableName.DialogueSegments, { channelId }, [
                                "platform",
                            ]);
                            const platforms = [...new Set(dialogues.map((d) => d.platform))];
                            if (platforms.length === 0) results.push(`🟡🟡🟡 频道 "${channelId}" 未找到`);
                            else if (platforms.length === 1)
                                targetsToProcess.push({ platform: platforms[0], channelId });
                            else ambiguousChannels.push(`频道 "${channelId}" 存在于多个平台: ${platforms.join(", ")}`);
                        }
                    }
                }

                if (ambiguousChannels.length > 0)
                    return `操作已中止:\n${ambiguousChannels.join("\n")}\n请使用 -p 或 -t 指定平台`;

                if (targetsToProcess.length === 0 && !options.target && !options.channel) {
                    if (session.platform && session.channelId)
                        targetsToProcess.push({ platform: session.platform, channelId: session.channelId });
                    else return "无法确定当前会话，请使用选项指定频道";
                }

                if (targetsToProcess.length === 0 && results.length === 0) return "没有指定任何有效的清理目标";

                for (const target of targetsToProcess) {
                    await performClear(
                        { platform: target.platform, channelId: target.channelId },
                        `目标 "${target.platform}:${target.channelId}"`
                    );
                }

                return `--- 清理报告 ---\n操作类型：${actionPastTense}\n${results.join("\n")}`;
            });
    }
}
// #endregion

// =================================================================================
// #region WorldStateService - 核心协调器
// =================================================================================
export class WorldStateService extends Service<HistoryConfig> {
    static readonly inject = [
        Services.Model,
        Services.Asset,
        Services.Logger,
        Services.Prompt,
        Services.Memory,
        "database",
    ];

    public summarizationManager: SummarizationManager;
    public contextBuilder: ContextBuilder;
    public segmentManager: DialogueSegmentManager;

    private _logger: Logger;
    private embedModel: IEmbedModel;
    private maintenanceTimer: NodeJS.Timeout;
    private eventListenerManager: EventListenerManager;
    private commandManager: HistoryCommandManager;

    constructor(ctx: Context, config: HistoryConfig) {
        super(ctx, Services.WorldState, true);
        this.ctx = ctx;
        this.config = config;

        // 初始化所有管理器
        this.segmentManager = new DialogueSegmentManager(ctx, config);
        this.summarizationManager = new SummarizationManager(ctx, config);
        this.contextBuilder = new ContextBuilder(ctx, config);
        this.eventListenerManager = new EventListenerManager(ctx, this, config);
        this.commandManager = new HistoryCommandManager(ctx, this, config);
    }

    protected start(): void {
        this._logger = this.ctx[Services.Logger].getLogger("[世界状态]");
        this.embedModel = this.ctx[Services.Model].useEmbeddingGroup(TaskType.Embedding)?.current;
        if (!this.embedModel) this._logger.warn("未找到任何可用的嵌入模型");

        this.registerModels();
        this.eventListenerManager.start();
        this.commandManager.register();

        // 维护任务现在更清晰
        this.maintenanceTimer = setInterval(() => {
            this.runMaintenanceTasks();
        }, this.config.cleanupIntervalSec * 1000);

        this._logger.info("服务已启动");
    }

    protected stop(): void {
        this.eventListenerManager.stop();
        if (this.maintenanceTimer) {
            clearInterval(this.maintenanceTimer);
        }
        this._logger.info("服务已停止");
    }

    // =================================================================================
    // #region 公共 API
    // =================================================================================

    public async getWorldState(session: Session): Promise<WorldState> {
        const { platform, channelId } = session;
        const bot = this.ctx.bots.find((b) => b.platform === platform && b.isActive);

        if (!bot) {
            this._logger.warn(`找不到平台 ${platform} 的在线机器人 | 频道: ${channelId}`);
            const channel = {
                id: channelId,
                platform,
                name: `Offline Channel ${channelId}`,
                type: "unknown",
                meta: {},
                members: [],
                history: { pending: undefined },
            };
            return { users: [], channel };
        }

        const worldState = session.isDirect
            ? await this.contextBuilder.buildPrivateChannelContext(bot, { platform, id: channelId })
            : await this.contextBuilder.buildGuildChannelContext(bot, { platform, id: channelId });

        return pruneHistoryByMessages(worldState, this.config.maxMessages);
    }

    public async recordAgentTurn(sid: string, responses: AgentResponse[]): Promise<void> {
        // 委托给 segmentManager
        await this.segmentManager.closeSegmentByAgent(sid, responses);

        const segmentRecord = await this.ctx.database
            .get(TableName.DialogueSegments, { id: sid })
            .then((res) => res[0]);
        if (segmentRecord) {
            await this.applyFoldingPolicy(segmentRecord.platform, segmentRecord.channelId);
        }
    }

    public async getOpenSegment(platform: string, channelId: string, guildId?: string): Promise<DialogueSegmentData> {
        // 委托给 segmentManager
        const segment = await this.segmentManager.getOrCreateOpenSegment(platform, channelId, guildId);
        // 如果在 getOrCreateOpenSegment 中关闭了冗余片段，也应触发折叠策略
        // 为确保一致性，可以在这里检查并触发
        if (segment.status === "open") {
            // 确保是新创建或已存在的开放片段
            const closedCount = await this.ctx.database.get(
                TableName.DialogueSegments,
                { platform, channelId, status: "closed" },
                { fields: ["id"] }
            );
            if (closedCount.length > this.config.fullContextSegmentCount) {
                await this.applyFoldingPolicy(platform, channelId);
            }
        }
        return segment;
    }

    public async recordMessage(segmentId: string, message: Omit<MessageData, "sid">): Promise<void> {
        // 委托给 segmentManager
        await this.segmentManager.recordMessage(segmentId, message);
    }

    /**
     * 引导模型关注被跳过的话题
     * @param channelKey 频道标识符 (platform:channelId)
     */
    public async guideToSkippedTopic(channelKey: string): Promise<void> {
        const [platform, channelId] = channelKey.split(":", 2);
        if (!platform || !channelId) return;

		const bot = this.ctx.bots.find(b => b.platform === platform);
		if (!bot) return;

		const session = {
		    platform,
		    channelId,
		    isDirect: channelId.startsWith('private:'),
		    bot,
		    // 其他必要属性
		} as any as Session;

        if (!session) return;

        const worldState = await this.getWorldState(session);

        // 添加提示引导模型关注被跳过的话题
        if (worldState.channel.history.pending) {
            worldState.channel.history.pending.dialogue.push({
                id: "system-guidance",
                content: "<系统提示>请注意，之前有未处理完的话题需要关注",
                timestamp: new Date(),
                sender: {
                    id: "system",
                    name: "系统",
                    roles: ["system"]
                }
            });
        }
    }

    // #endregion

    // =================================================================================
    // #region 内部辅助方法
    // =================================================================================

    public isChannelAllowed(session: Session): boolean {
        const cid = session.cid;
        const platform = session.platform;
        const allowed = Array.from(this.config.allowedChannels);
        return allowed.some(
            (c) =>
                c === cid ||
                c === "*:*" ||
                c === `${platform}:*` ||
                c === `${platform}:all` ||
                c === `${platform}:private:*` ||
                c === `${platform}:private:all` ||
                c === `${platform}:guild:*` ||
                c === `${platform}:guild:all`
        );
    }

    public async transformMessageContent(elements: Element[], session: Session): Promise<string> {
        // 使用 assets 服务的 transformer 处理所有资源元素
        // 注意：这里不需要手动调用 transformer，因为它已经通过中间件自动处理了
        // 但为了保持接口兼容性，我们仍然提供这个方法
        const transformedElements = await h.transformAsync(elements, async (element) => {
            // 如果元素已经有 id（被 assets transformer 处理过），则创建占位符
            if ((element.type === "img" || element.type === "image") && element.attrs.id) {
                return h("image", {
                    id: element.attrs.id,
                    summary: element.attrs.summary || element.attrs.alt || "图片"
                });
            }
            return element;
        });
        return transformedElements.join("");
    }

    // #endregion

    // =================================================================================
    // #region 维护与策略
    // =================================================================================

    private registerModels(): void {
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
                startTimestamp: "timestamp",
                endTimestamp: "timestamp",
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
            { id: "string(64)", sid: "string(64)", type: "string(64)", timestamp: "timestamp", payload: "json" },
            { primary: "id", foreign: { sid: [TableName.DialogueSegments, "id"] } }
        );
    }

    private async applyFoldingPolicy(platform: string, channelId: string): Promise<void> {
        const closedSegments = await this.ctx.database.get(TableName.DialogueSegments, {
            platform,
            channelId,
            status: "closed",
        });
        if (closedSegments.length > this.config.fullContextSegmentCount) {
            const segmentsToFold = closedSegments
                .sort((a, b) => a.startTimestamp.getTime() - b.startTimestamp.getTime())
                .slice(0, closedSegments.length - this.config.fullContextSegmentCount);
            const idsToFold = segmentsToFold.map((s) => s.id);
            if (idsToFold.length > 0) {
                await this.ctx.database.set(
                    TableName.DialogueSegments,
                    { id: { $in: idsToFold } },
                    { status: "folded" }
                );
                this._logger.debug(`折叠了 ${idsToFold.length} 个旧片段 | 频道: ${platform}:${channelId}`);
            }
        }
    }

    private runMaintenanceTasks(): void {
        this.eventListenerManager.cleanupPendingCommands();

        // **核心优化：执行片段状态检查**
        this.segmentManager
            .checkAndCloseOpenSegments()
            .then(() => {
                // 检查关闭后，可能需要对涉及的频道应用折叠策略
                // (为简化，此步可省略，或在 checkAndCloseOpenSegments 内部实现更复杂的逻辑)
            })
            .catch((error) => this._logger.error("对话片段状态检查任务执行失败", error.message));

        this._cleanupExpiredRecords().catch((error) => this._logger.error("清理过期记录任务执行失败", error.message));

        if (this.config.summarization.enabled) {
            this.summarizationManager
                .targetSummarizationTasks()
                .catch((error) => this._logger.error("自动总结任务执行失败", error.message));
        }
    }

    private async _cleanupExpiredRecords(): Promise<void> {
        const expirationTime = this.config.dataRetentionDays * 24 * 60 * 60 * 1000;
        const expirationCutoff = new Date(Date.now() - expirationTime);

        const expiredSegments = await this.ctx.database.get(TableName.DialogueSegments, {
            startTimestamp: { $lt: expirationCutoff },
        });
        if (expiredSegments.length > 0) {
            const segmentIds = expiredSegments.map((s) => s.id);
            await this.ctx.database.withTransaction(async (db) => {
                await db.remove(TableName.Messages, { sid: { $in: segmentIds } });
                await db.remove(TableName.SystemEvents, { sid: { $in: segmentIds } });
                await db.remove(TableName.DialogueSegments, { id: { $in: segmentIds } });
            });
            this._logger.info(`清理了 ${expiredSegments.length} 个过期的对话片段及其相关记录`);
        }
    }
    // #endregion
}
// #endregion
