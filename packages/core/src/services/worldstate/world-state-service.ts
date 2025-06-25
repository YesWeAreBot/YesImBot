import { $, Context, Random, Service, Session } from "koishi";
import { Services } from "../types";
import { WorldStateConfig } from "./config";
import { AgentTurn, Channel, DialogueSegment, Member, MemberSummary, WorldState } from "./interfaces";
import { AgentTurnData, DialogueSegmentData, TableName } from "./model";
import { MemberRepository } from "./repositories";
import { DialogueSegmentRepository } from "./repositories/dialogue-segment";

// 在 Koishi 的 Context 接口上声明我们的服务，以获得完整的类型提示
declare module "koishi" {
    interface Context {
        [Services.WorldState]: WorldStateService;
    }

    interface Events {
        /** 当对话片段有更新时触发 */
        "worldstate:segment-updated"(session: Session, segmentId: string, channelId: string, platform: string): void;
    }
}

/**
 * WorldState 服务
 *
 * 核心职责:
 * 1. 监听 Koishi 事件总线，捕获世界状态的变化（消息、成员变动等）。
 * 2. 调用仓储层(Repositories)，将这些变化以结构化的形式持久化到数据库。
 * 3. 对外提供获取完整世界状态快照(WorldState)的接口，供 Agent 使用。
 */
export class WorldStateService extends Service<WorldStateConfig> {
    public readonly members: MemberRepository;
    public readonly segments: DialogueSegmentRepository;

    private cleanupTimer?: NodeJS.Timeout; // 用于持有定时器的引用

    private disposer: (() => boolean)[] = [];

    constructor(ctx: Context, config: WorldStateConfig) {
        super(ctx, Services.WorldState, true);
        this.config = config;

        // 应用所有数据库模型定义
        ctx.plugin(require("./model"));

        // 实例化仓储层，并传入 ctx
        this.members = new MemberRepository(ctx);
        this.segments = new DialogueSegmentRepository(ctx, this.members);
    }

    /**
     * Koishi 服务生命周期方法，在插件启动时调用。
     * 我们在这里注册所有的事件监听器。
     */
    protected start(): void {
        this.ctx.logger.info("WorldState Service started, listening to events...");

        // 监听所有消息事件
        this.disposer.push(this.ctx.on("message", (session) => this.onMessage(session), true));

        // 监听成员加入事件
        this.disposer.push(this.ctx.on("guild-member-added", (session) => this.onMemberJoined(session)));

        // 监听成员离开事件
        this.disposer.push(this.ctx.on("guild-member-removed", (session) => this.onMemberLeft(session)));

        // 监听群组信息更新事件
        this.disposer.push(this.ctx.on("guild-updated", (session) => this.onChannelUpdated(session)));

        // --- 启动定期清理任务 ---
        this.startCleanupTask();
    }

    /**
     * Koishi 服务生命周期方法，在插件停止时调用。
     * 可用于清理资源，如定时器。
     */
    protected stop(): void {
        this.ctx.logger.info("WorldState Service stopped.");

        // -- 清理事件监听器 ---
        this.disposer.forEach((dispose) => dispose());

        // --- 停止清理任务，防止内存泄漏 ---
        this.stopCleanupTask();
    }

    // --- 事件处理器 ---
    private async onMessage(session: Session): Promise<void> {
        if (session.selfId === session.userId) return;
        try {
            const segment = await this.segments.getOrCreateOpenSegment(session.platform, session.channelId);

            const payload = {
                quote: session.quote,
                actor: {
                    // 使用 actor 字段
                    id: session.userId,
                    name: session.author.name,
                    avatar: session.author.avatar,
                    nick: session.author.nick,
                },
                content: session.content,
                messageId: session.messageId,
            };

            await this.ctx.database.create(TableName.Events, {
                id: `${session.messageId}`,
                segmentId: segment.id,
                type: "message",
                timestamp: new Date(session.timestamp),
                payload,
            });

            const [kUser] = await this.ctx.database.get("binding", { platform: session.platform, pid: session.author.id });
            if (!kUser) return;

            await this.ctx.database.upsert("user", [
                {
                    id: kUser.aid,
                    name: session.author.name,
                },
            ]);

            await this.ctx.database.upsert(TableName.Members, [
                {
                    uid: kUser.aid,
                    platform: session.platform,
                    channelId: session.channelId,
                    pid: session.author.id,
                    lastActive: new Date(),
                },
            ]);

            await this.updateChannelActivity(session);
            await this.members.updateMemberActivity(session.platform, session.channelId, session.author.id);

            this.ctx.parallel("worldstate:segment-updated", session, segment.id, session.channelId, session.platform);
        } catch (error) {
            this.ctx.logger.error("Error handling message event:", error.message);
            this.ctx.logger.error(error.stack);
        }
    }

    private async onMemberJoined(session: Session): Promise<void> {
        try {
            const segment = await this.segments.getOrCreateOpenSegment(session.platform, session.channelId);
            const payload = {
                actorId: session.operatorId || "system",
                userId: session.userId,
            };
            await this.ctx.database.create(TableName.Events, {
                id: `evt_${Date.now()}_${session.userId}`,
                segmentId: segment.id,
                type: "member-joined",
                timestamp: new Date(session.timestamp),
                payload,
            });
            await this.updateChannelMemberCount(session);
        } catch (error) {
            this.ctx.logger.error("Error handling member-joined event:", error);
        }
    }

    private async onMemberLeft(session: Session): Promise<void> {
        try {
            const segment = await this.segments.getOrCreateOpenSegment(session.platform, session.channelId);
            const payload = {
                actorId: session.operatorId || session.userId,
                userId: session.userId,
            };
            await this.ctx.database.create(TableName.Events, {
                id: `evt_${Date.now()}_${session.userId}`,
                segmentId: segment.id,
                type: "member-left",
                timestamp: new Date(session.timestamp),
                payload,
            });
            await this.updateChannelMemberCount(session);
        } catch (error) {
            this.ctx.logger.error("Error handling member-left event:", error);
        }
    }

    private async onChannelUpdated(session: Session): Promise<void> {
        const platformChannel = session.event.channel;
        if (!platformChannel) return;

        try {
            await this.ctx.database.upsert("channel", [
                {
                    id: platformChannel.id,
                    platform: session.platform,
                    name: platformChannel.name,
                },
            ]);
        } catch (error) {
            this.ctx.logger.error("Error handling channel-updated event:", error);
        }
    }

    private async updateChannelActivity(session: Session): Promise<void> {
        await this.ctx.database.upsert("channel", [
            {
                id: session.channelId,
                platform: session.platform,
                guildId: session.guildId,
                lastActivityAt: new Date(),
                name: session.event?.channel?.name,
            },
        ]);
    }

    private async updateChannelMemberCount(session: Session): Promise<void> {
        if (!session.guildId) return;
        try {
            const memberCount = await session.bot
                .getGuild(session.guildId)
                .then((g) => 0)
                .catch(() => null);
            if (memberCount !== null) {
                await this.ctx.database.upsert("channel", [
                    {
                        id: session.channelId,
                        platform: session.platform,
                        memberCount,
                    },
                ]);
            }
        } catch (error) {
            this.ctx.logger.warn(`Failed to update member count for channel ${session.channelId}:`, error);
        }
    }

    public async getWorldState(allowedChannelIds: string[]): Promise<WorldState> {
        this.ctx.logger.info(`Generating world state for ${allowedChannelIds.length} allowed channels...`);

        const allChannelRecords = await this.ctx.database.get("channel", { id: allowedChannelIds });

        const activeThreshold = new Date(Date.now() - this.config.ActiveChannelHours * 60 * 60 * 1000);

        const activeChannelPromises: Promise<Channel>[] = [];
        const inactiveChannelRecords: Partial<Channel>[] = [];

        for (const record of allChannelRecords) {
            if (record.lastActivityAt > activeThreshold) {
                activeChannelPromises.push(this.getFullChannel(record.platform, record.id));
            } else {
                inactiveChannelRecords.push({
                    id: record.id,
                    platform: record.platform,
                    name: record.name,
                    type: this.determineChannelType(record),
                });
            }
        }

        const activeChannels = await Promise.all(activeChannelPromises);

        this.ctx
            .logger("worldstate")
            .info(`World state generated. Active: ${activeChannels.length}, Inactive: ${inactiveChannelRecords.length}.`);

        return {
            timestamp: new Date().toISOString(),
            activeChannels,
            inactiveChannels: inactiveChannelRecords as Channel[],
        };
    }

    public async getFullChannel(platform: string, channelId: string): Promise<Channel> {
        const [channelRecord] = await this.ctx.database.get("channel", { id: channelId, platform });
        if (!channelRecord || !channelRecord.guildId) throw new Error(`Channel record not found for ${platform}:${channelId}`);

        const segmentRecords = await this.ctx.database.get(
            TableName.DialogueSegments,
            { platform, channelId },
            { limit: this.config.MaxTurnsPerChannel, sort: { startTimestamp: "desc" } }
        );

        const history: (DialogueSegment | AgentTurn)[] = [];
        const recentActors = new Map<string, Member>();

        for (const segRecord of segmentRecords) {
            const segment = await this.segments.hydrateSegment(segRecord, platform, channelRecord.guildId, channelId);
            history.push(segment);

            for (const event of segment.events) {
                const actor = (event.payload as any).actor;
                if (actor && !recentActors.has(actor.id)) {
                    recentActors.set(actor.id, actor);
                }
                const user = (event.payload as any).user;
                if (user && !recentActors.has(user.id)) {
                    recentActors.set(user.id, user);
                }
            }

            const agentTurnRecord = await this.ctx.database.get(TableName.AgentTurns, { stimulusSegmentId: segRecord.id });
            if (agentTurnRecord.length > 0) {
                const agentTurn = await this.hydrateAgentTurn(agentTurnRecord[0]);
                history.push(agentTurn);
            }
        }

        history.sort((a, b) => a.startTimestamp.getTime() - b.startTimestamp.getTime());

        return {
            ...channelRecord,
            name: channelRecord.name || `频道 ${channelRecord.id}`,
            type: this.determineChannelType(channelRecord),
            members: Array.from(recentActors.values()),
            memberSummary: await this.getMemberSummary(platform, channelId),
            history,
        };
    }

    public async findOpenSegmentRecord(channelId: string, platform: string): Promise<DialogueSegmentData> {
        return this.ctx.database.get(TableName.DialogueSegments, { channelId, platform, status: "open" }).then((res) => res[0]);
    }

    public async getChannelRecord(channelId: string, platform: string): Promise<Channel> {
        return this.ctx.database.get("channel", { id: channelId, platform }).then((res) => res[0]) as Promise<Channel>;
    }

    public async createAgentTurn(segment: DialogueSegment): Promise<AgentTurnData> {
        const agentTurnData: AgentTurnData = {
            id: `turn_${Date.now()}_${Random.id(8)}`,
            stimulusSegmentId: segment.id,
            channelId: segment.channelId,
            platform: segment.platform,
            status: "in_progress",
            startTimestamp: new Date(),
            endTimestamp: new Date(),
        };
        await this.ctx.database.create(TableName.AgentTurns, agentTurnData);
        return agentTurnData;
    }

    private async hydrateAgentTurn(turnRecord: AgentTurnData): Promise<AgentTurn> {
        const responses = await this.ctx.database.get(TableName.AgentResponses, { turnId: turnRecord.id });
        return {
            id: turnRecord.id,
            platform: turnRecord.platform,
            channelId: turnRecord.channelId,
            stimulusSegmentId: turnRecord.stimulusSegmentId,
            status: turnRecord.status,
            responses: responses.map((r) => ({
                thoughts: r.thoughts as any,
                actions: r.actions as any,
                observations: r.observations as any,
                request_heartbeat: false, // This needs to be stored in the DB
            })),
            startTimestamp: turnRecord.startTimestamp,
            endTimestamp: turnRecord.endTimestamp,
            is_agent_turn: true,
            is_dialogue_segment: false,
        };
    }

    private async getMemberSummary(platform: string, channelId: string): Promise<MemberSummary> {
        const recentThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [totalCount, recentActiveCount] = await Promise.all([
            this.ctx.database.eval(TableName.Members, (row) => $.count(row.uid), { platform, channelId }),
            this.ctx.database.eval(TableName.Members, (row) => $.count(row.uid), {
                platform,
                channelId,
                lastActive: { $gte: recentThreshold },
            }),
        ]);

        return {
            totalCount,
            onlineCount: 0,
            recentActiveCount,
        };
    }

    private determineChannelType(channelRecord: import("koishi").Channel): "group" | "private" {
        return channelRecord.flag & 1 ? "private" : "group";
    }

    private startCleanupTask(): void {
        const intervalMs = 24 * 60 * 60 * 1000;

        this.performDataCleanup().catch((error) => this.ctx.logger.error("Initial data cleanup failed:", error));

        this.cleanupTimer = setInterval(() => {
            this.performDataCleanup().catch((error) => this.ctx.logger.error("Scheduled data cleanup failed:", error));
        }, intervalMs);

        this.ctx.logger.info("Scheduled data cleanup task started.");
    }

    private stopCleanupTask(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
            this.ctx.logger.info("Scheduled data cleanup task stopped.");
        }
    }

    public async performDataCleanup(): Promise<{ deletedTurns: number; deletedEvents: number; deletedResponses: number }> {
        this.ctx.logger.info("Performing data cleanup...");

        const retentionDays = this.config.DataRetentionDays;
        if (!retentionDays || retentionDays <= 0) {
            this.ctx.logger.info("Data retention is disabled. Skipping cleanup.");
            return { deletedTurns: 0, deletedEvents: 0, deletedResponses: 0 };
        }

        const retentionDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

        const expiredTurns = await this.ctx.database.get(TableName.AgentTurns, {
            endTimestamp: { $lt: retentionDate },
        });

        if (expiredTurns.length === 0) {
            this.ctx.logger.info("No expired data to clean up.");
            return { deletedTurns: 0, deletedEvents: 0, deletedResponses: 0 };
        }

        const expiredTurnIds = expiredTurns.map((t) => t.id);

        const [eventRemoveResult, responseRemoveResult] = await Promise.all([
            this.ctx.database.remove(TableName.Events, { segmentId: { $in: expiredTurnIds } }),
            this.ctx.database.remove(TableName.AgentResponses, { turnId: { $in: expiredTurnIds } }),
        ]);

        const turnRemoveResult = await this.ctx.database.remove(TableName.AgentTurns, { id: { $in: expiredTurnIds } });

        const result = {
            deletedTurns: turnRemoveResult.removed,
            deletedEvents: eventRemoveResult.removed,
            deletedResponses: responseRemoveResult.removed,
        };

        this.ctx
            .logger("worldstate")
            .info(
                `Data cleanup completed. Deleted ${result.deletedTurns} turns, ${result.deletedEvents} events, and ${result.deletedResponses} agent responses.`
            );
        return result;
    }
}
