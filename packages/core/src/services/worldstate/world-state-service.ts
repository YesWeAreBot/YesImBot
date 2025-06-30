import { Context, Random, Service, Session } from "koishi";
import { ModelGroup } from "../model";
import { Services } from "../types";
import { WorldStateConfig } from "./config";
import { AgentTurnData, DialogueSegmentData, TableName } from "./database-models";
import * as Model from "./database-models";
import { AgentTurn, Channel, DialogueSegment, WorldState } from "./interfaces";

// 在 Koishi 的 Context 接口上声明我们的服务，以获得完整的类型提示
declare module "koishi" {
    interface Context {
        [Services.WorldState]: WorldStateService;
    }

    interface Events {
        /** 当对话片段有更新时触发 */
        "worldstate:segment-updated"(session: Session, segment: DialogueSegment): void;
    }
}

/**
 * WorldState 服务
 * 负责收集、管理和提供 Agent 所需的上下文信息（世界状态）。
 * 实现了多阶段的上下文压缩和清理机制，以平衡上下文质量、成本和性能。
 */
export class WorldStateService extends Service {
    static readonly inject = [Services.Model];
    private disposer: (() => boolean)[] = [];

    constructor(ctx: Context, config: WorldStateConfig) {
        super(ctx, Services.WorldState, true);
        this.config = config;
    }

    /**
     * Koishi 服务生命周期方法，在插件启动时调用。
     * 我们在这里注册事件监听器和后台定时任务。
     */
    protected start(): void {
        this.init();
        this.ctx.logger.info("WorldState Service started, listening to events...");

        // 监听所有消息事件，以构建对话片段
        this.disposer.push(this.ctx.on("message", (session) => this.onMessage(session), true));

        // 启动后台清理任务
        const cleanupTask = setInterval(() => this.cleanupOldRecords(), this.config.CleanupInterval);
        this.disposer.push(() => {
            clearInterval(cleanupTask);
            return true;
        });
    }

    protected stop(): void {
        this.disposer.forEach((dispose) => dispose());
        this.ctx.logger.info("WorldState Service stopped.");
    }

    private async init() {
        this.ctx.model.extend(
            TableName.Members,
            {
                uid: "unsigned",
                pid: "string(255)",
                platform: "string(255)",
                guildId: "string(255)", // 关键变更
                name: "string(255)",
                username: "string(255)",
                roles: "json",
                avatar: "string(255)",
                joinedAt: "timestamp",
                lastActive: "timestamp",
            },
            {
                autoInc: false,
                primary: ["uid", "platform", "guildId"], // 关键变更
                foreign: {
                    uid: ["user", "id"],
                },
            }
        );

        this.ctx.model.extend(
            TableName.DialogueSegments,
            {
                id: "string(64)",
                platform: "string(255)",
                channelId: "string(255)",
                guildId: "string(255)", // 新增字段
                status: "string(32)",
                summary: "text",
                timestamp: "timestamp",
            },
            { primary: "id" }
        );

        this.ctx.model.extend(
            TableName.AgentTurns,
            {
                id: "string(64)",
                sid: "string(64)",
                platform: "string(255)",
                channelId: "string(255)",
                status: "string(32)",
                timestamp: "timestamp",
            },
            {
                primary: "id",
                foreign: { sid: [TableName.DialogueSegments, "id"] },
            }
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
                content: "text", // 关键变更
                quoteId: "string(255)",
            },
            {
                primary: ["id", "platform"],
                foreign: { sid: [TableName.DialogueSegments, "id"] },
            }
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
            {
                primary: "id",
                foreign: { sid: [TableName.DialogueSegments, "id"] },
            }
        );

        this.ctx.model.extend(
            TableName.AgentResponses,
            {
                id: "unsigned",
                turnId: "string(64)",
                thoughts: "json",
                actions: "json",
                observations: "json",
                request_heartbeat: "boolean", // 新增字段
            },
            {
                autoInc: true,
                primary: "id",
                foreign: { turnId: [TableName.AgentTurns, "id"] },
            }
        );
    }

    // --- 公共 API ---

    /**
     * 获取指定频道集合的完整世界状态。
     * @param allowedChannels 允许 Agent 访问的频道列表
     * @returns WorldState 对象
     */
    public async getWorldState(allowedChannels: { Platform: string; Id: string }[]): Promise<WorldState> {
        const activeChannels = await Promise.all(allowedChannels.map(({ Platform, Id }) => this.buildFullContextForChannel(Platform, Id)));

        return {
            timestamp: new Date().toISOString(),
            activeChannels: activeChannels,
            inactiveChannels: [], // inactiveChannels 的逻辑可以后续实现
        };
    }

    /**
     * 创建一个新的 Agent 回合。
     * 此操作会关闭当前频道的开放对话片段。
     * @param platform 平台名称
     * @param channelId 频道ID
     * @returns 创建的 AgentTurn 对象
     */
    public async createAgentTurn(platform: string, channelId: string): Promise<AgentTurn> {
        // 1. 找到并关闭当前开放的对话片段
        const openSegment = await this.getOrCreateOpenSegment(platform, channelId);
        if (openSegment) {
            await this.ctx.database.set(TableName.DialogueSegments, { id: openSegment.id }, { status: "closed" });
        }

        // 2. 创建新的 Agent 回合记录
        const turnRecord = await this.ctx.database.create(TableName.AgentTurns, {
            id: `turn_${Date.now()}_${Random.id(8)}`,
            // 如果没有开放的片段，sid 可以为空
            sid: openSegment?.id ?? null,
            channelId: channelId,
            platform: platform,
            status: "in_progress",
            timestamp: new Date(),
        });

        // 3. 构造并返回完整的 AgentTurn 对象
        return this.constructFullAgentTurn(turnRecord);
    }

    // --- 核心上下文构建与压缩逻辑 ---

    /**
     * 为单个频道构建包含完整历史和压缩逻辑的上下文。
     * 这是整个服务最核心的方法。
     * @param platform 平台名称
     * @param channelId 频道ID
     * @returns 构建好的 Channel 对象
     */
    private async buildFullContextForChannel(platform: string, channelId: string): Promise<Channel> {
        const historyLimit = this.config.MaxHistoryItemsPerChannel;

        // 1. 获取比限制更多的近期历史记录，为压缩留出空间
        const rawSegments = await this.ctx.database
            .select(TableName.DialogueSegments)
            .where({ platform, channelId, status: { $ne: "archived" } }) // 排除已归档的
            .orderBy("timestamp", "desc")
            .limit(historyLimit * 2)
            .execute();

        const rawTurns = await this.ctx.database
            .select(TableName.AgentTurns)
            .where({ platform, channelId })
            .orderBy("timestamp", "desc")
            .limit(historyLimit * 2)
            .execute();

        // 2. 合并并按时间排序
        let combinedHistory: (DialogueSegmentData | any)[] = [...rawSegments, ...rawTurns].sort(
            (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
        );

        // 3. 应用多阶段压缩策略
        const { finalHistory, segmentsToFold, segmentsToSummarize } = this.applyHistoryCompressionPolicy(combinedHistory);

        // 4. 异步触发状态变更，不阻塞主流程
        if (segmentsToFold.length > 0) {
            this.ctx.database.set(TableName.DialogueSegments, { id: { $in: segmentsToFold.map((s) => s.id) } }, { status: "folded" });
        }
        if (segmentsToSummarize.length > 0) {
            // 异步执行昂贵的总结操作
            segmentsToSummarize.forEach((segment) => this.summarizeSegment(segment.id).catch((err) => this.ctx.logger.error(err)));
        }

        // 5. 构造完整的领域对象
        const dialogueSegments = await Promise.all(
            finalHistory.filter((item) => "is_dialogue_segment" in item).map((record) => this.constructFullSegment(record))
        );
        const agentTurns = await Promise.all(
            finalHistory.filter((item) => "is_agent_turn" in item).map((record) => this.constructFullAgentTurn(record))
        );

        // 6. 再次合并排序返回最终结果
        const history = [...dialogueSegments, ...agentTurns].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        const memberRecords = await this.ctx.database.get(TableName.Members, { platform, guildId: channelId });

        return {
            id: channelId,
            name: channelId,
            type: "guild",
            platform: platform,
            meta: {},
            members: memberRecords,
            history: history,
        };
    }

    /**
     * 对历史记录应用压缩策略，决定哪些记录被保留、折叠或需要总结。
     * @param history 原始的、按时间排序的历史记录
     * @returns 处理后的历史记录和需要状态变更的片段列表
     */
    private applyHistoryCompressionPolicy(history: (DialogueSegmentData | any)[]) {
        let finalHistory = [...history];
        const segmentsToFold = new Set<DialogueSegmentData>();

        let turnsInHistory = finalHistory.filter((item) => item.sid); // AgentTurn 有 sid

        // 阶段一：当历史总数超过限制时，优先移除最旧的 AgentTurn
        while (finalHistory.length > this.config.MaxHistoryItemsPerChannel && turnsInHistory.length > this.config.MinAgentTurnsToKeep) {
            const oldestTurnIndex = finalHistory.findIndex((item) => item.sid);
            if (oldestTurnIndex === -1) break; // 没有可移除的 Turn 了

            const [removedTurn] = finalHistory.splice(oldestTurnIndex, 1);

            // 找到被此 Turn 关闭的对话片段，并标记为 'folded'
            const correspondingSegment = history.find((s) => s.id === removedTurn.sid && s.status === "closed");
            if (correspondingSegment) {
                segmentsToFold.add(correspondingSegment);
            }

            turnsInHistory = finalHistory.filter((item) => item.sid);
        }

        // 阶段二：检查 'folded' 状态的片段数量，决定是否需要总结
        const foldedSegmentsInHistory = finalHistory.filter((item) => item.status === "folded");
        const segmentsToSummarize: DialogueSegmentData[] = [];
        if (foldedSegmentsInHistory.length > this.config.MaxFoldedSegments) {
            const excessCount = foldedSegmentsInHistory.length - this.config.MaxFoldedSegments;
            // 将最旧的几个'folded'片段加入待总结列表
            segmentsToSummarize.push(...foldedSegmentsInHistory.slice(0, excessCount));
        }

        return {
            finalHistory,
            segmentsToFold: Array.from(segmentsToFold),
            segmentsToSummarize,
        };
    }

    // --- 后台任务与辅助方法 ---

    /**
     * 对一个对话片段执行总结操作。
     * @param segmentId 要总结的片段ID
     */
    private async summarizeSegment(segmentId: string): Promise<void> {
        if (!this.config.EnableSummarization) return;

        this.ctx.logger.info(`Summarizing segment ${segmentId}...`);
        const messages = await this.ctx.database.get(TableName.Messages, { sid: segmentId });
        if (messages.length === 0) {
            await this.ctx.database.set(
                TableName.DialogueSegments,
                { id: segmentId },
                { status: "summarized", summary: "无有效对话内容。" }
            );
            return;
        }

        const dialogueText = messages.map((msg) => `${msg.sender.name || msg.sender.pid}: ${msg.content}`).join("\n");

        const prompt = this.config.SummarizationPrompt.replace("{dialogueText}", dialogueText);

        try {
            const chatModel = this.ctx[Services.Model].useGroup(ModelGroup.Summarization).getCurrent();
            const { text: summary } = await chatModel.chat([{ role: "user", content: prompt }]);
            await this.ctx.database.set(
                TableName.DialogueSegments,
                { id: segmentId },
                {
                    status: "summarized",
                    summary: summary.trim(),
                }
            );
            this.ctx.logger.info(`Segment ${segmentId} summarized successfully.`);

            // 总结完成后，可以安全删除原始消息以节省空间
            await this.ctx.database.remove(TableName.Messages, { sid: segmentId });
        } catch (error) {
            this.ctx.logger.error(`Failed to summarize segment ${segmentId}:`, error);
        }
    }

    /**
     * 后台清理任务：归档和删除旧数据。
     */
    private async cleanupOldRecords(): Promise<void> {
        this.ctx.logger.info("Running background cleanup task...");
        const retentionDate = new Date(Date.now() - this.config.DataRetentionDays * 24 * 60 * 60 * 1000);

        // 1. 将过期的 'summarized' 片段变为 'archived'
        const segmentsToArchive = await this.ctx.database.set(
            TableName.DialogueSegments,
            { status: "summarized", timestamp: { $lt: retentionDate } },
            { status: "archived" }
        );
        if (segmentsToArchive.matched > 0) {
            this.ctx.logger.info(`Archived ${segmentsToArchive.matched} old segments.`);
        }

        // 2. 物理删除 'archived' 的片段及其关联的 AgentTurn
        const archivedSegments = await this.ctx.database.get(TableName.DialogueSegments, { status: "archived" });
        if (archivedSegments.length > 0) {
            const archivedSegmentIds = archivedSegments.map((s) => s.id);
            await this.ctx.database.remove(TableName.AgentTurns, { sid: { $in: archivedSegmentIds } });
            await this.ctx.database.remove(TableName.DialogueSegments, { id: { $in: archivedSegmentIds } });
            this.ctx.logger.info(`Permanently deleted ${archivedSegmentIds.length} archived segments and their related turns.`);
        }
    }

    // --- 事件处理器 ---
    /**
     * 消息处理流程
     */
    private async onMessage(session: Session): Promise<void> {
        // 更新或创建成员信息 (使用 guildId)
        if (session.guildId) {
            const [binding] = await this.ctx.database.get("binding", { platform: session.platform, pid: session.userId });
            if (binding) {
                await this.ctx.database.upsert(TableName.Members, [
                    {
                        uid: binding.aid,
                        pid: session.userId,
                        platform: session.platform,
                        guildId: session.guildId, // 使用 guildId
                        name: session.author.nick || session.author.name,
                        username: session.author.username,
                        roles: session.author.roles,
                        avatar: session.author.avatar,
                        lastActive: new Date(),
                    },
                ]);
            }
        }

        // 获取或创建当前开放的对话片段
        const segmentRecord = await this.getOrCreateOpenSegment(session.platform, session.channelId, session.guildId);

        // 消息入库
        await this.ctx.database.create(TableName.Messages, {
            id: session.messageId,
            sid: segmentRecord.id,
            channelId: session.channelId,
            platform: session.platform,
            sender: {
                pid: session.userId,
                name: session.author.nick || session.author.name,
                roles: session.author.roles,
            },
            timestamp: new Date(session.timestamp),
            content: session.content,
            quoteId: session.quote?.id,
        });

        // 此处可以触发事件，但注意避免在事件处理中再次进行昂贵的数据库查询
        const dialogueSegment = await this.constructFullSegment(segmentRecord);
        this.ctx.emit("worldstate:segment-updated", session, dialogueSegment);
    }

    public async getOrCreateOpenSegment(platform: string, channelId: string, guildId?: string): Promise<DialogueSegmentData> {
        const openSegments = await this.ctx.database
            .select(TableName.DialogueSegments)
            .where({ platform, channelId, status: "open" })
            .orderBy("timestamp", "desc")
            .limit(1)
            .execute();

        if (openSegments.length > 0) {
            return openSegments[0];
        }

        const newSegment: DialogueSegmentData = {
            id: `seg_${Date.now()}_${Random.id(8)}`,
            platform,
            channelId,
            guildId,
            status: "open",
            timestamp: new Date(),
        };
        await this.ctx.database.create(TableName.DialogueSegments, newSegment);
        return newSegment;
    }

    /**
     * 根据对话片段ID构造完整的 DialogueSegment 对象。
     * @param segmentId
     */
    async constructFullSegment(segmentRecord: DialogueSegmentData): Promise<DialogueSegment> {
        // 获取此片段的消息记录
        const messageRecords = await this.ctx.database.get(TableName.Messages, { sid: segmentRecord.id });

        // 获取此片段的系统事件记录
        const systemEventRecords = await this.ctx.database.get(TableName.SystemEvents, { sid: segmentRecord.id });

        // 构造 DialogueSegment 对象
        const dialogueSegment: DialogueSegment = {
            type: "dialogue-segment",
            id: segmentRecord.id,
            platform: segmentRecord.platform,
            channelId: segmentRecord.channelId,
            status: segmentRecord.status,
            dialogue: messageRecords,
            systemEvents: systemEventRecords.map((record) => ({
                id: record.id,
                type: record.type,
                timestamp: record.timestamp,
                payload: record.payload,

                /**
                 * 可选的类型守卫属性，例如 `is_member_join_event: true`，
                 * 便于在代码中进行类型收窄。
                 */
                [`is_${record.type}`]: true,
            })),
            timestamp: segmentRecord.timestamp,
        };

        return dialogueSegment;
    }

    async constructFullAgentTurn(turnRecord: AgentTurnData): Promise<AgentTurn> {
        // 获取此回合的响应记录
        const responseRecords = await this.ctx.database.get(TableName.AgentResponses, { turnId: turnRecord.id });

        // 构造 AgentTurn 对象
        const agentTurn: AgentTurn = {
            type: "agent-turn",
            id: turnRecord.id,
            platform: turnRecord.platform,
            channelId: turnRecord.channelId,
            stimulusSegmentId: turnRecord.sid,
            status: turnRecord.status,
            responses: responseRecords,
            timestamp: turnRecord.timestamp,
        };

        return agentTurn;
    }
}
