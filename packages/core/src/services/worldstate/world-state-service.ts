import { $, Context, Random, Service, Session } from "koishi";
import { Services } from "../types";
import { WorldStateConfig } from "./config";
import { Channel, DialogueSegment, Member, MemberSummary, WorldState } from "./interfaces";
import { DialogueSegmentData, TableName } from "./model";
import { MemberRepository } from "./repositories";
import { DialogueSegmentRepository } from "./repositories/dialogue-segment";

// 在 Koishi 的 Context 接口上声明我们的服务，以获得完整的类型提示
declare module "koishi" {
    interface Context {
        [Services.WorldState]: WorldStateService;
    }

    interface Events {
        /** 当对话片段有更新时触发 */
        "worldstate:segment-updated"(segmentId: string, channelId: string, platform: string): void;
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

    private disposer: (() => boolean)[];

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

        // this.ctx.on("guild-added", (session) => this.onChannelUpdated(session));

        // 监听成员加入事件
        this.disposer.push(this.ctx.on("guild-member-added", (session) => this.onMemberJoined(session)));

        // 监听成员离开事件
        this.disposer.push(this.ctx.on("guild-member-removed", (session) => this.onMemberLeft(session)));

        // this.ctx.on("guild-member-request", (session) => this.onMessageReacted(session));

        // this.ctx.on("guild-member-updated", (session) => this.onMessageReacted(session));

        // this.ctx.on("guild-removed", (session) => this.onChannelUpdated(session));

        // this.ctx.on("guild-request", (session) => this.onChannelUpdated(session));

        // 监听群组信息更新事件
        this.disposer.push(this.ctx.on("guild-updated", (session) => this.onChannelUpdated(session)));

        // TODO: 可在此处扩展监听更多事件，如消息撤回、用户资料更新等
        // this.ctx.on("message-deleted", (session) => this.onMessageDeleted(session));

        // this.ctx.on("message-updated", (session) => this.onMessageUpdated(session));

        // this.ctx.on("message-pinned", (session) => this.onMessagePinned(session));

        // this.ctx.on("message-unpinned", (session) => this.onMessageUnpinned(session));

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
            // 1. 获取或创建当前开放的对话片段
            const segment = await this.segments.getOrCreateOpenSegment(session.platform, session.channelId);

            // 2. 准备事件负载
            const payload = {
                /* ... */
            };

            // 3. 将事件持久化到数据库
            await this.ctx.database.create(TableName.Events, {
                id: `evt_${Date.now()}_${session.messageId}`,
                segmentId: segment.id, // 修改
                type: "message",
                timestamp: new Date(session.timestamp),
                payload,
            });

            // 4. 更新活跃状态
            await this.updateChannelActivity(session);
            await this.members.updateMemberActivity(session.platform, session.channelId, session.author.id);

            // 广播片段更新事件
            this.ctx.parallel("worldstate:segment-updated", segment.id, session.channelId, session.platform);
        } catch (error) {
            this.ctx.logger.error("Error handling message event:", error);
        }
    }

    private async onMemberJoined(session: Session): Promise<void> {
        try {
            const turn = await this.segments.getOrCreateOpenSegment(session.platform, session.channelId);
            const payload = {
                actorId: session.operatorId || "system", // 操作者，如果未知则为 'system'
                userId: session.userId, // 加入的成员
            };
            await this.ctx.database.create(TableName.Events, {
                id: `evt_${Date.now()}_${session.userId}`,
                segmentId: turn.id,
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
            const turn = await this.segments.getOrCreateOpenSegment(session.platform, session.channelId);
            const payload = {
                actorId: session.operatorId || session.userId, // 如果是自己退群，操作者就是自己
                userId: session.userId, // 离开的成员
            };
            await this.ctx.database.create(TableName.Events, {
                id: `evt_${Date.now()}_${session.userId}`,
                segmentId: turn.id,
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
        // 当频道信息（如名称）更新时，同步到我们的数据库
        const platformChannel = session.event.channel;
        if (!platformChannel) return;

        try {
            await this.ctx.database.upsert("channel", [
                {
                    id: platformChannel.id,
                    platform: session.platform,
                    name: platformChannel.name,
                    // 如果能获取到描述等信息，也在此处更新
                },
            ]);
        } catch (error) {
            this.ctx.logger.error("Error handling channel-updated event:", error);
        }
    }

    // --- 状态更新辅助方法 ---

    /** 更新频道的最后活跃时间和名称（如果需要） */
    private async updateChannelActivity(session: Session): Promise<void> {
        await this.ctx.database.upsert("channel", [
            {
                id: session.channelId,
                platform: session.platform,
                guildId: session.guildId, // 确保 guildId 也被存储
                lastActivityAt: new Date(),
                // 如果消息事件中的频道名是最新的，可以在此更新
                name: session.event?.channel?.name,
            },
        ]);
    }

    /**
     * 更新频道的成员总数。
     * 注意：这是一个开销较大的操作，只在成员变动时调用。
     */
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

    /**
     * 获取当前完整的世界状态快照。
     * 这是提供给 Agent 使用的核心入口点。
     * @param allowedChannelIds 一个包含所有允许被 Agent 感知的频道ID的数组。
     * @returns 一个包含活跃和非活跃频道的完整 WorldState 对象。
     */
    public async getWorldState(allowedChannelIds: string[]): Promise<WorldState> {
        this.ctx.logger.info(`Generating world state for ${allowedChannelIds.length} allowed channels...`);

        // 从数据库中获取所有允许的频道的基础信息
        const allChannelRecords = await this.ctx.database.get("channel", { id: allowedChannelIds });

        // 根据配置和最后活跃时间，将频道分为“活跃”和“非活跃”两类
        // 注意: 这里的 '1 * 60 * 60 * 1000' (1小时) 应该是一个可配置项，暂时硬编码
        const activeThreshold = new Date(Date.now() - 1 * 60 * 60 * 1000);

        const activeChannelPromises: Promise<Channel>[] = [];
        const inactiveChannelRecords: Partial<Channel>[] = [];

        for (const record of allChannelRecords) {
            // 如果频道活跃且未达到显示上限，则获取其完整信息
            if (record.lastActivityAt > activeThreshold /* && activeChannelPromises.length < this.config.ActiveChannelLimit */) {
                activeChannelPromises.push(this.getFullChannel(record.platform, record.id));
            } else {
                // 对于不活跃的频道，只提供基础信息以节省Token和性能
                inactiveChannelRecords.push({
                    id: record.id,
                    platform: record.platform,
                    name: record.name,
                    type: this.determineChannelType(record),
                });
            }
        }

        // 并行地、高效地获取所有活跃频道的完整上下文
        const activeChannels = await Promise.all(activeChannelPromises);

        this.ctx
            .logger("worldstate")
            .info(`World state generated. Active: ${activeChannels.length}, Inactive: ${inactiveChannelRecords.length}.`);

        return {
            timestamp: new Date().toISOString(),
            activeChannels,
            inactiveChannels: inactiveChannelRecords as Channel[], // 类型断言，因为我们只提供了部分字段
        };
    }

    /**
     * 获取单个频道的完整、深度上下文信息。
     * [阶段一简化版]
     */
    public async getFullChannel(platform: string, channelId: string): Promise<Channel> {
        const [channelRecord] = await this.ctx.database.get("channel", { id: channelId, platform });
        if (!channelRecord || !channelRecord.guildId) throw new Error(/* ... */);

        // 获取最近的 DialogueSegment 记录
        const segmentRecords = await this.ctx.database.get(
            TableName.DialogueSegments,
            { platform, channelId },
            { limit: 10 /* this.config.MaxSegmentsPerChannel */, sort: { startTimestamp: "desc" } }
        );

        // 并行地水合所有片段
        const historySegments = await Promise.all(
            segmentRecords.map((seg) => this.segments.hydrateSegment(seg, platform, channelRecord.guildId, channelId))
        );

        // ... 组装 Member, MemberSummary 等信息 (逻辑与旧版类似) ...
        // --- 步骤 2: 提取历史事件中所有相关的成员 ---
        // 虽然事件在仓储层已被水合，但我们可能需要一个独立的、在频道层面展示的成员列表
        // 这里可以根据策略（如最近发言者、被@者）来决定展示哪些成员
        const recentActors = new Map<string, Member>();
        for (const turn of historySegments) {
            for (const event of turn.events) {
                const actor = (event.payload as any).actor;
                if (actor && !recentActors.has(actor.id)) {
                    recentActors.set(actor.id, actor);
                }
                const user = (event.payload as any).user;
                if (user && !recentActors.has(user.id)) {
                    recentActors.set(user.id, user);
                }
            }
        }

        return {
            ...channelRecord,
            name: channelRecord.name || `频道 ${channelRecord.id}`,
            type: this.determineChannelType(channelRecord),
            // ... 其他频道信息 ...
            members: Array.from(recentActors.values()),
            memberSummary: await this.getMemberSummary(platform, channelId),
            history: historySegments, // [阶段一] history 只包含 DialogueSegment
        };
    }

    public async findOpenSegmentRecord(channelId: string, platform: string): Promise<DialogueSegmentData> {
        return this.ctx.database.get(TableName.DialogueSegments, { channelId, platform, status: "open" }).then((res) => res[0]);
    }

    public async getChannelRecord(channelId: string, platform: string): Promise<Channel> {
        return this.ctx.database.get("channel", { id: channelId, platform }).then((res) => res[0]) as Promise<Channel>;
    }

    public async createAgentTurn(segment: DialogueSegment) {
        this.ctx.database.create(TableName.AgentTurns, {
            id: `turn_${Date.now()}_${Random.id(8)}`,
            stimulusSegmentId: segment.id,
            channelId: segment.channelId,
            platform: segment.platform,
            status: "in_progress",
            startTimestamp: new Date(),
            endTimestamp: new Date(),
        });
    }

    // --- 状态获取辅助方法 ---

    /**
     * 获取频道的成员宏观统计信息。
     */
    private async getMemberSummary(platform: string, channelId: string): Promise<MemberSummary> {
        // 注意: 这里的 '7 * 24 * ...' (7天) 应该是一个可配置项
        const recentThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [totalCount, recentActiveCount] = await Promise.all([
            // 获取总成员数
            this.ctx.database.eval(TableName.Members, (row) => $.count(row.uid), { platform, channelId }),
            // 获取近期活跃成员数
            this.ctx.database.eval(TableName.Members, (row) => $.count(row.uid), {
                platform,
                channelId,
                lastActive: { $gte: recentThreshold },
            }),
        ]);

        return {
            totalCount,
            onlineCount: 0, // 在线状态难以获取，暂时设为0
            recentActiveCount,
        };
    }

    /**
     * 根据数据库中的频道记录确定其类型。
     */
    private determineChannelType(channelRecord: import("koishi").Channel): "group" | "private" {
        return channelRecord.flag & 1 ? "private" : "group"; // Koishi 使用 flag & 1 判断是否为私聊
    }

    private startCleanupTask(): void {
        // 定时器每24小时执行一次
        const intervalMs = 24 * 60 * 60 * 1000;

        // 立即执行一次，然后再设置定时器
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

    /**
     * 执行数据清理任务。
     * 公开此方法，也方便通过指令手动触发。
     */
    public async performDataCleanup(): Promise<{ deletedTurns: number; deletedEvents: number; deletedResponses: number }> {
        this.ctx.logger.info("Performing data cleanup...");

        const retentionDays = this.config.DataRetentionDays;
        if (!retentionDays || retentionDays <= 0) {
            this.ctx.logger.info("Data retention is disabled. Skipping cleanup.");
            return { deletedTurns: 0, deletedEvents: 0, deletedResponses: 0 };
        }

        const retentionDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

        // 1. 查找所有过期的回合 (Turns)
        const expiredTurns = await this.ctx.database.get(TableName.AgentTurns, {
            endTimestamp: { $lt: retentionDate },
        });

        if (expiredTurns.length === 0) {
            this.ctx.logger.info("No expired data to clean up.");
            return { deletedTurns: 0, deletedEvents: 0, deletedResponses: 0 };
        }

        const expiredTurnIds = expiredTurns.map((t) => t.id);

        // 2. 使用过期的回合ID，批量删除所有相关的子表记录
        const [eventRemoveResult, responseRemoveResult] = await Promise.all([
            this.ctx.database.remove(TableName.Events, { segmentId: { $in: expiredTurnIds } }),
            this.ctx.database.remove(TableName.AgentResponses, { turnId: { $in: expiredTurnIds } }),
        ]);

        // 3. 最后删除过期的回合主表记录
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
