import { Argv, Context, Element, h, Logger, Random, Service, Session } from "koishi";
import { ChannelDescriptor } from "../../agent";
import { ChatModel, ModelGroup } from "../model";
import { Services, TableName } from "../types";
import { AgentResponse } from "./agent-response-types";
import { HistoryConfig } from "./config";
import { DialogueSegmentData } from "./database-models";
import { CommandInvocationPayload } from "./event-types";
import { AgentTurn, Channel, DialogueSegment, GuildMember, Sender, WorldState } from "./interfaces";

/**
 *
 * @param date
 * @param format
 * @returns
 */
function formatDate(date: Date, format: string = "YYYY-MM-DD HH:mm:ss"): string {
    const pad = (num: number) => String(num).padStart(2, "0");
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();

    return format
        .replace(/YYYY/g, String(year))
        .replace(/YY/g, String(year).slice(-2))
        .replace(/MM/g, pad(month))
        .replace(/M/g, String(month))
        .replace(/DD/g, pad(day))
        .replace(/D/g, String(day))
        .replace(/HH/g, pad(hours))
        .replace(/H/g, String(hours))
        .replace(/mm/g, pad(minutes))
        .replace(/m/g, String(minutes))
        .replace(/ss/g, pad(seconds))
        .replace(/s/g, String(seconds));
}

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
 * 3. 管理对话片段的生命周期（open -> closed -> folded -> summarized -> archived）。
 * 4. 为 Agent 提供一个干净、完整、且经过策略压缩的上下文视图 (WorldState)。
 * 5. 执行后台维护任务，如自动总结和清理旧数据。
 */
export class WorldStateService extends Service<HistoryConfig> {
    // =================================================================================
    // #region 静态属性和依赖注入
    // =================================================================================

    /** 代表由 AI 逻辑（如 send_message 工具）产生的消息发送者。 */
    public static readonly AI_SENDER: Sender = {
        pid: "agent",
        name: "Assistant",
        roles: ["ai", "assistant"],
    };

    /** 代表人类操作员使用机器人账号发送的消息的发送者。 */
    public static readonly OPERATOR_SENDER: Sender = {
        pid: "operator",
        name: "Operator",
        roles: ["human", "operator"],
    };

    static readonly inject = [Services.Model, Services.Image, Services.Logger];

    // #endregion

    // =================================================================================
    // #region 实例属性
    // =================================================================================

    private _logger: Logger;
    private chatModel: ChatModel;
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

        this._logger = ctx[Services.Logger].getLogger("[世界状态]");

        this.chatModel = this.ctx[Services.Model].useGroup(ModelGroup.Summarization)?.getCurrent();

        if (!this.chatModel) {
            this._logger.warn("未找到任何可用的总结模型，自动总结功能将不可用");
        }
    }

    /**
     * 服务启动时调用，负责注册数据库模型、监听事件和启动定时任务。
     */
    protected start(): void {
        this.registerDatabaseModels();

        // 注册事件监听器，采用职责分离的模式
        this.registerEventListeners();

        // 注册CLI指令，用于手动管理
        this.registerCommands();

        // 启动后台维护任务
        this.maintenanceInterval = setInterval(() => {
            this.handleMaintenance();
        }, this.config.advanced.cleanupIntervalMs);

        // this._logger.info("WorldState Service started, using middleware for user messages.");
        this._logger.info("服务已启动");
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
        // this._logger.info("WorldState Service stopped.");
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
     * @param allowedChannels 允许 Agent 访问的频道描述符列表。
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
        await this.ctx.database.set(TableName.DialogueSegments, { id: segmentRecord.id }, { status: "closed", agentTurn });
        // this._logger.debug(`Segment ${segmentRecord.id} closed and agent turn recorded.`);
        this._logger.debug(`片段 ${segmentRecord.id} 已关闭，并记录了 Agent 回合。`);

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
            .where({ platform, channelId, status: "open" })
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
            status: "open",
            agentTurn: null,
            timestamp: new Date(),
        };
        await this.ctx.database.create(TableName.DialogueSegments, newSegment);
        return newSegment;
    }

    // #endregion

    // =================================================================================
    // #region 事件处理器
    // =================================================================================

    /**
     * 优雅地处理纯用户消息，由 Koishi 中间件保证其纯粹性。
     * @param session 消息会话对象。
     */
    private async handleUserMessage(session: Session): Promise<void> {
        // 检查是否在允许的频道中
        let allowed = false;
        if (this.config.allowedChannels.has(session.cid)) {
            allowed = true;
        } else if (this.config.allowedChannels.has("*:*")) {
            allowed = true;
        } else if (this.config.allowedChannels.has(`${session.platform}:*`)) {
            allowed = true;
        } else if (this.config.allowedChannels.has(`${session.platform}:all`)) {
            allowed = true;
        }

        if (!allowed) {
            if (this.config.system.debug.enable) {
                // this._logger.info(`Message from ${session.author.name} in ${session.cid} ignored.`);
            }
            return;
        }

        // this._logger.debug(`[WorldState] Handling user message via middleware: ${session.messageId}`);

        const segmentRecord = await this.getOpenSegment(session.platform, session.channelId, session.guildId);

        if (session.guildId) {
            await this.updateMemberInfo(session);
        }

        const transformedContent = await h
            .transformAsync(session.elements, async (element) => {
                switch (element.type) {
                    case "text":
                        return h.escape(element.attrs.content);
                    case "img":
                    case "image":
                        return await this.ctx[Services.Image].processImageElement(element, session);
                    default:
                        return element;
                }
            })
            .then((res) => res.join(" ").trim());

        await this.recordMessage(segmentRecord.id, {
            id: session.messageId,
            platform: session.platform,
            channelId: session.channelId,
            sender: {
                pid: session.userId,
                name: session.author.nick || session.author.name,
                roles: session.author.roles,
            },
            content: transformedContent,
            timestamp: new Date(session.timestamp),
            quoteId: session.quote?.id,
        });

        const dialogueSegment = await this.buildDialogueSegment(segmentRecord, "");
        this.ctx.emit("worldstate:segment-updated", session, dialogueSegment);
    }

    /**
     * 处理指令调用事件，在数据库中创建事件记录，并在内存中创建待定状态。
     * @param argv 指令的参数对象。
     */
    private async handleCommand(argv: Argv): Promise<void> {
        const { session, command, args, options, source } = argv;
        if (!session) return;

        // this._logger.debug(`[WorldState] Handling command invocation: ${command.name}`);

        const segmentRecord = await this.getOpenSegment(session.platform, session.channelId, session.guildId);

        // 1. 在数据库中创建事件
        const commandEventId = `cmd_invoked_${session.messageId}`;
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

        // 2. 在内存中创建待定状态
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

    /**
     * 处理所有由机器人程序化发送的消息（AI工具、指令回复等）。
     * 核心职责是区分这是“指令结果”还是“普通AI回复”。
     * @param session 即将发送消息的会话对象。
     */
    private async handleBotProgrammaticMessage(session: Session): Promise<void> {
        // 尝试将此消息匹配到一个待定的指令
        if (session.scope && (await this.tryMatchCommandResult(session))) {
            // 如果匹配成功，说明这是指令的结果，已经处理完毕，直接返回。
            return;
        }

        // 如果没有匹配，则为普通AI消息（如 ReAct 的 send_message）
        this._logger.debug(`[WorldState] Recording a regular programmatic AI message.`);
        const openSegment = await this.getOpenSegment(session.platform, session.channelId, session.guildId);
        if (!openSegment) return;

        await this.recordMessage(openSegment.id, {
            id: `bot_intent_${Random.id(12)}`,
            platform: session.platform,
            channelId: session.channelId,
            sender: WorldStateService.AI_SENDER,
            content: session.content,
            timestamp: new Date(),
        });
    }

    /**
     * 处理由 'message' 事件捕获的机器人自身消息。
     * 这只可能发生在两种情况下：
     * 1. 开启了自身消息上报，这是程序化消息的回响（应被忽略）。
     * 2. 操作员手动使用机器人账号发送消息（应被记录）。
     * @param session 消息会话对象。
     */
    private async handleOperatorMessage(session: Session): Promise<void> {
        // 由于 onBotProgrammaticMessage 已处理所有意图，
        // 任何到达这里的机器人消息都可被视为操作员消息。
        // （未来可加入更复杂的去重逻辑，但目前此简化是健壮的）

        this._logger.debug(`[WorldState] Handling operator message: ${session.messageId}`);
        const segmentRecord = await this.getOpenSegment(session.platform, session.channelId, session.guildId);

        await this.recordMessage(segmentRecord.id, {
            id: session.messageId,
            platform: session.platform,
            channelId: session.channelId,
            sender: {
                ...WorldStateService.OPERATOR_SENDER,
                pid: session.bot.selfId,
                name: session.bot.user.name || "Operator",
            },
            content: session.content,
            timestamp: new Date(session.timestamp),
            quoteId: session.quote?.id,
        });

        const dialogueSegment = await this.buildDialogueSegment(segmentRecord, "");
        this.ctx.emit("worldstate:segment-updated", session, dialogueSegment);
    }

    // #endregion

    // =================================================================================
    // #region 私有辅助方法
    // =================================================================================

    private registerEventListeners(): void {
        // 1. 中间件：处理所有纯用户消息
        this.disposers.push(
            this.ctx.middleware(async (session, next) => {
                await this.handleUserMessage(session);
                return next();
            })
        );

        // 2. 指令调用事件
        this.disposers.push(this.ctx.on("command/before-execute", (argv) => this.handleCommand(argv), true));

        // 3. 机器人程序化输出事件
        this.disposers.push(this.ctx.on("before-send", (session) => this.handleBotProgrammaticMessage(session), true));

        // 4. 边缘案例：操作员手动消息
        this.disposers.push(
            this.ctx.on("message", async (session) => {
                if (session.userId === session.bot.selfId) {
                    await this.handleOperatorMessage(session);
                }
            })
        );
    }

    private registerCommands(): void {
        this.ctx.command("history.summarize", "手动触发当前频道的历史记录总结", { authority: 3 }).action(async ({ session }) => {
            try {
                await this.summarizeAndArchive(session.platform, session.channelId);
                return "手动总结任务已触发并完成。";
            } catch (error) {
                this._logger.error(error);
                return "总结任务失败，请检查日志。";
            }
        });

        this.ctx.command("history.clear", "清除当前频道的历史记录", { authority: 3 }).action(async ({ session }) => {
            await this.ctx.database.set(
                TableName.DialogueSegments,
                { platform: session.platform, channelId: session.channelId },
                { status: "archived" }
            );
            return "频道历史记录已清除（标记为已归档）。";
        });
    }

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
                sender: "json",
                timestamp: "timestamp",
                content: "text",
                quoteId: "string(255)",
            },
            { primary: ["id", "platform"], foreign: { sid: [TableName.DialogueSegments, "id"] } }
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
     * 将一条消息记录到指定的对话片段中。
     * 这是一个核心的数据库操作，被多个事件处理器调用。
     *
     * @param segmentId 目标对话片段的 ID。
     * @param message 包含消息所有必要信息对象。
     */
    public async recordMessage(
        segmentId: string,
        message: { id: string; platform: string; channelId: string; sender: Sender; content: string; timestamp: Date; quoteId?: string }
    ): Promise<void> {
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
        this._logger.debug(`Recorded message ${message.id} into segment ${segmentId}`);
    }

    /**
     * 更新或插入成员信息到数据库。
     * @param session 包含作者信息的消息会话。
     */
    private async updateMemberInfo(session: Session): Promise<void> {
        if (!session.guildId) return;

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
     * 尝试将一条程序化消息与一个待定的指令进行匹配。
     * @param session 带有 scope 的消息会话。
     * @returns 如果匹配并处理成功，返回 true，否则 false。
     */
    private async tryMatchCommandResult(session: Session): Promise<boolean> {
        const pendingInChannel = this.pendingCommands.get(session.channelId);
        if (!pendingInChannel || pendingInChannel.length === 0) return false;

        // 从后往前找，因为最新的调用最可能先被回复。
        const pendingIndex = pendingInChannel.findIndex((p) => p.scope === session.scope); // 简化查找，可根据需要增加 invokerId 匹配

        if (pendingIndex !== -1) {
            const pendingCmd = pendingInChannel[pendingIndex];
            this._logger.debug(`[WorldState] Matched bot message to pending command event: ${pendingCmd.commandEventId}`);

            // 更新数据库事件并完成状态
            await this.addResultToCommandEvent(pendingCmd.commandEventId, session.content);
            pendingInChannel.splice(pendingIndex, 1);

            return true;
        }
        return false;
    }

    /**
     * [NEW] 用于更新指令事件的辅助函数
     */
    private async addResultToCommandEvent(eventId: string, result: string): Promise<void> {
        const existingEvents = await this.ctx.database.get(TableName.SystemEvents, { id: eventId });
        if (existingEvents.length === 0) return;

        const updatedPayload: CommandInvocationPayload = { ...existingEvents[0].payload, result } as CommandInvocationPayload;
        await this.ctx.database.set(TableName.SystemEvents, { id: eventId }, { payload: updatedPayload });

        // 可以选择在这里再次触发 worldstate:segment-updated 事件
    }

    /**
     * 为单个频道构建完整的上下文信息，包括频道元数据、成员列表和历史记录。
     * @param platform 平台名称。
     * @param channelId 频道 ID。
     * @param onetimeCode 一次性代码。
     * @returns 一个完整的 `Channel` 对象。
     */
    private async buildFullContextForChannel(channel: ChannelDescriptor, onetimeCode: string): Promise<Channel> {
        const { platform, id } = channel;
        const bot = this.ctx.bots.find((b) => b.platform === platform && b.isActive);
        if (!bot) {
            this._logger.warn(`Could not find an online bot for platform "${platform}" to build channel context.`);
        }

        const channelInfo = await bot?.getChannel(id);
        if (!channelInfo) {
            this._logger.warn(`Failed to get channel info for ${platform}:${id}`);
            // 即使获取失败，也返回一个基础对象以保证健壮性
            return { id, platform: platform, name: `Channel ${id}`, type: "guild", meta: {}, members: [], history: [] };
        }

        // 1. 获取所有非归档的对话片段记录
        const segmentRecords = await this.ctx.database
            .get(TableName.DialogueSegments, {
                platform: platform,
                channelId: id,
                status: { $ne: "archived" },
            })
            .then((res) => res.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()));

        // 2. 并行构建所有对话片段的完整内容
        const history: DialogueSegment[] = await Promise.all(
            segmentRecords.map((record) => this.buildDialogueSegment(record, onetimeCode))
        );

        // 3. 从构建好的历史中收集所有人类成员的 ID
        const memberIds = new Set<string>();
        history.forEach((segment) => {
            segment.dialogue.forEach((message) => {
                if (message.sender.pid !== "agent" && message.sender.pid !== "operator") {
                    memberIds.add(message.sender.pid);
                }
            });
        });

        // 4. 一次性从数据库查询所有相关成员信息
        const humanMembers: GuildMember[] =
            memberIds.size > 0
                ? await this.ctx.database.get(TableName.Members, {
                      platform: platform,
                      guildId: id,
                      pid: { $in: Array.from(memberIds) },
                  })
                : [];

        // 5. 注入机器人自身作为成员
        const allMembers: GuildMember[] = [...humanMembers];
        if (bot) {
            const botAsMember: GuildMember = {
                pid: bot.selfId,
                name: bot.user.name,
                nick: bot.user.nick || bot.user.name,
                roles: ["assistant", "bot"],
                isSelf: true,
            };
            // 插入到列表开头
            allMembers.unshift(botAsMember);
        }

        return {
            id,
            name: channelInfo.name,
            type: "guild", // 此处可根据 channelInfo 进一步细化
            platform: platform,
            meta: {},
            members: allMembers,
            history: history,
        };
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

        dialogueSegment.dialogue = messageRecords.map((record) => ({
            id: record.id,
            content: transform(record.content),
            timestamp: record.timestamp,
            date: formatDate(record.timestamp),
            quoteId: record.quoteId,
            sender: record.sender,
        }));

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
            status: "closed",
        });

        if (closedSegments.length > this.config.fullContextSegmentCount) {
            const segmentsToFold = closedSegments
                .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                .slice(0, closedSegments.length - this.config.fullContextSegmentCount);

            const idsToFold = segmentsToFold.map((s) => s.id);
            if (idsToFold.length > 0) {
                await this.ctx.database.set(TableName.DialogueSegments, { id: { $in: idsToFold } }, { status: "folded" });
                this._logger.info(`Folded ${idsToFold.length} segments in channel ${channelId}.`);
            }
        }
    }

    // #endregion

    // =================================================================================
    // #region 后台维护任务
    // =================================================================================

    private handleMaintenance(): void {
        this._logger.debug("Running maintenance tasks...");

        this.cleanupPendingCommands();

        if (this.config.enableSummarization && this.chatModel) {
            this.triggerSummarizationForEligibleChannels().catch((error) => {
                this._logger.error("Error during summarization maintenance task:", error);
            });
        }
    }

    // [NEW] 在维护任务中加入清理过期待定指令的逻辑
    private cleanupPendingCommands(): void {
        const now = Date.now();
        const expirationTime = 5 * 60 * 1000; // 5 分钟
        for (const [channelId, commands] of this.pendingCommands.entries()) {
            const filteredCommands = commands.filter((cmd) => now - cmd.timestamp < expirationTime);
            if (filteredCommands.length === 0) {
                this.pendingCommands.delete(channelId);
            } else {
                this.pendingCommands.set(channelId, filteredCommands);
            }
        }
    }

    /**
     * 查找并触发符合总结条件的频道的总结归档流程。
     */
    private async triggerSummarizationForEligibleChannels(): Promise<void> {
        const channelsToSummarize = await this.findChannelsWithSufficientFoldedSegments();
        for (const channel of channelsToSummarize) {
            await this.summarizeAndArchive(channel.platform, channel.channelId);
        }
    }

    /**
     * 查找哪些频道有足够多的 'folded' 片段以触发总结。
     * @returns 需要总结的频道列表。
     */
    private async findChannelsWithSufficientFoldedSegments(): Promise<{ platform: string; channelId: string }[]> {
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
        const foldedSegments = (await this.ctx.database.get(TableName.DialogueSegments, { platform, channelId, status: "folded" })).sort(
            (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
        );

        if (foldedSegments.length < this.config.summarizationTriggerCount) return;

        const groupIds = foldedSegments.map((s) => s.id);
        const latestTimestamp = foldedSegments[foldedSegments.length - 1].timestamp;

        // 生成对话文本并调用模型进行总结
        const dialogueText = await this.renderSegmentsToText(foldedSegments);
        if (!dialogueText) return;

        const prompt = this.config.summarizationPrompt.replace("{dialogueText}", dialogueText);
        const summaryResponse = await this.chatModel.chat([{ role: "user", content: prompt }]);
        const summaryText = summaryResponse?.text;

        if (!summaryText) {
            this._logger.warn(`Summarization failed for channel ${channelId}: no response from model.`);
            return;
        }

        // 创建新的总结片段
        const summarySegment: DialogueSegmentData = {
            id: `sum_${Date.now()}_${Random.id(8)}`,
            platform: platform,
            channelId: channelId,
            guildId: foldedSegments[0].guildId,
            status: "summarized",
            summary: summaryText,
            timestamp: latestTimestamp,
            agentTurn: null,
        };

        // 在一个事务中创建总结片段并归档旧片段
        await this.ctx.database.withTransaction(async (db) => {
            await db.create(TableName.DialogueSegments, summarySegment);
            await db.set(TableName.DialogueSegments, { id: { $in: groupIds } }, { status: "archived" });
        });

        this._logger.info(`Successfully summarized ${groupIds.length} segments into one for channel ${channelId}.`);
    }

    /**
     * 将一组对话片段渲染为纯文本，用于总结。
     * 优化：此方法现在依赖 `messages` 表作为单一事实来源，确保用户和 AI 的消息都被正确包含和排序。
     * @param segments 一组需要被渲染为文本的对话片段数据。
     * @returns 格式化后的完整对话历史字符串。
     */
    private async renderSegmentsToText(segments: DialogueSegmentData[]): Promise<string> {
        if (!segments || segments.length === 0) return "";

        const segmentIds = segments.map((segment) => segment.id);

        // 1. 一次性获取所有相关消息
        const allMessages = await this.ctx.database.get(TableName.Messages, {
            sid: { $in: segmentIds },
        });

        // 2. 按时间戳排序，构建正确的对话流
        allMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        // 3. 格式化为文本
        const dialogueLines = allMessages.map((msg) => {
            const senderName = msg.sender.name || "Unknown";
            const timestampStr = formatDate(msg.timestamp);
            // 将 h 元素转换为纯文本
            const contentText = h
                .parse(msg.content)
                .map((el) => el.toString())
                .join("");
            return `[${timestampStr}] ${senderName}: ${contentText}`;
        });

        return dialogueLines.join("\n");
    }

    // #endregion
}
