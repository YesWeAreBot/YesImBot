import { Context, Service, Session } from "koishi";

import { Config } from "@/config";
import { Services, TableName } from "@/shared/constants";
import { HistoryCommandManager } from "./commands";
import { ContextBuilder } from "./context-builder";
import { EventListenerManager } from "./event-listener";
import { InteractionManager } from "./interaction-manager";
import { SemanticMemoryManager } from "./l2-semantic-memory";
import { ArchivalMemoryManager } from "./l3-archival-memory";
import { AgentStimulus, DiaryEntryData, MemberData, MemoryChunkData, MessageData, SystemEventData, WorldState } from "./types";

declare module "koishi" {
    interface Context {
        [Services.WorldState]: WorldStateService;
    }
    interface Events {
        "agent/stimulus": (stimulus: AgentStimulus<any>) => void;
        "agent/bot-muted": (target: { platform: string; selfId: string; channelId: string }) => void;
    }
    interface Tables {
        [TableName.Members]: MemberData;
        [TableName.Messages]: MessageData;
        [TableName.SystemEvents]: SystemEventData;
        [TableName.L2Chunks]: MemoryChunkData;
        [TableName.L3Diaries]: DiaryEntryData;
    }
}

export class WorldStateService extends Service<Config> {
    static readonly inject = [Services.Model, Services.Asset, Services.Logger, Services.Prompt, Services.Memory, "database"];

    public l1_manager: InteractionManager;
    public l2_manager: SemanticMemoryManager;
    public l3_manager: ArchivalMemoryManager;

    private contextBuilder: ContextBuilder;
    private eventListenerManager: EventListenerManager;
    private commandManager: HistoryCommandManager;
    private readonly mutedChannels = new Map<string, number>();
    private readonly allMutedChannels = new Map<string, number>();

    private clearTimer: ReturnType<Context["setInterval"]> | null = null;

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.WorldState, true);
        this.config = config;
        this.logger = this.ctx[Services.Logger].getLogger("[世界状态]");

        // Initialize all managers
        this.l1_manager = new InteractionManager(ctx, config);
        this.l2_manager = new SemanticMemoryManager(ctx, config);
        this.l3_manager = new ArchivalMemoryManager(ctx, config, this.l1_manager, this.l2_manager);
        this.contextBuilder = new ContextBuilder(ctx, config, this.l1_manager, this.l2_manager, this.l3_manager);
        this.eventListenerManager = new EventListenerManager(ctx, this, config);
        this.commandManager = new HistoryCommandManager(ctx, this, config);
    }

    protected async start(): Promise<void> {
        this.registerModels();
        await this.initializeMuteStatus();
        this.scheduleClearTask();

        // Start sub-services
        this.l2_manager.start();
        this.l3_manager.start();
        this.eventListenerManager.start();
        this.commandManager.register();

        this.logger.info("服务已启动");
    }

    protected async stop(): Promise<void> {
        this.eventListenerManager.stop();
        const stoppingDiaries = this.l3_manager.stop();
        if (this.clearTimer) {
            this.clearTimer();
            this.clearTimer = null;
        }
        await Promise.all([this.l2_manager.stop(), stoppingDiaries]);
        this.logger.info("服务已停止");
    }

    public async buildWorldState(session: Session): Promise<WorldState> {
        return await this.contextBuilder.build(session);
    }

    public async recordMessage(message: MessageData): Promise<void> {
        await this.l1_manager.recordMessage(message);
        if (this.config.l2_memory.enabled) {
            this.l2_manager.addMessageToBuffer(message);
        }
    }

    public isChannelAllowed(session: Session): boolean {
        const { platform, channelId, guildId, isDirect, userId } = session;
        return this.config.allowedChannels.some((c) => {
            return (
                c.platform === platform &&
                c.type === (isDirect ? "private" : "guild") &&
                (c.id === "*" || c.id === channelId || (guildId && c.id === guildId) || (c.type === "private" && c.id === userId))
            );
        });
    }

    public async recordSystemEvent(event: SystemEventData): Promise<void> {
        await this.l1_manager.recordSystemEvent(event);
    }

    /** 查询使用纯读取，不清除到期状态。 */
    public peekBotMuted(channelCid: string, selfId?: string): boolean {
        const now = Date.now();
        return this.muteKeys(channelCid, selfId).some(key =>
            (this.mutedChannels.get(key) || 0) > now || (this.allMutedChannels.get(key) || 0) > now
        );
    }

    public isBotMuted(channelCid: string, selfId?: string): boolean {
        const now = Date.now();
        for (const key of this.muteKeys(channelCid, selfId)) {
            for (const states of [this.mutedChannels, this.allMutedChannels]) {
                const expiresAt = states.get(key);
                if (expiresAt !== undefined && expiresAt <= now) states.delete(key);
            }
        }
        return this.peekBotMuted(channelCid, selfId);
    }

    private muteKeys(cid: string, selfId?: string): string[] {
        if (selfId !== undefined) return [JSON.stringify([cid, selfId]), cid];
        // 保留旧 API 的频道级查询；内部回复路径始终传入机器人身份。
        const prefix = JSON.stringify([cid]).slice(0, -1) + ",";
        return [cid, ...new Set([...this.mutedChannels.keys(), ...this.allMutedChannels.keys()].filter(key => key.startsWith(prefix)))];
    }

    public updateMuteStatus(cid: string, expiresAt: number, selfId?: string, kind: "individual" | "all" = "individual"): void {
        const key = selfId === undefined ? cid : JSON.stringify([cid, selfId]);
        const states = kind === "all" ? this.allMutedChannels : this.mutedChannels;
        if (expiresAt > Date.now()) {
            states.set(key, expiresAt);
            this.logger.debug(`[${cid}] Bot[${selfId ?? "*"}] | 已被禁言 | 解封时间: ${expiresAt === Infinity ? "永久" : new Date(expiresAt).toLocaleString()}`);
            const separator = cid.indexOf(":");
            const platform = cid.slice(0, separator);
            const channelId = cid.slice(separator + 1);
            const ids = selfId === undefined ? this.ctx.bots.filter(bot => bot.platform === platform).map(bot => bot.selfId) : [selfId];
            for (const id of ids) this.ctx.emit("agent/bot-muted", { platform, selfId: id, channelId });
        } else {
            states.delete(key);
            this.logger.debug(`[${cid}] Bot[${selfId ?? "*"}] | ${kind === "all" ? "全体" : "单独"}禁言状态已解除`);
        }
    }

    private async initializeMuteStatus(): Promise<void> {
        this.logger.info("正在从历史记录初始化机器人禁言状态...");
        const events = await this.ctx.database.get(TableName.SystemEvents, {
            type: { $in: ["guild-member-ban", "guild-member-unban", "guild-all-member-ban", "guild-all-member-unban"] },
        });
        events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        for (const event of events) {
            const details = (event.payload as any)?.details;
            if (!details) continue;
            const cid = `${event.platform}:${event.channelId}`;
            const userId = details.user?.id === undefined ? undefined : String(details.user.id);
            const allMembers = event.type.startsWith("guild-all-member-") ||
                (event.type === "guild-member-unban" && (userId === undefined || userId === "0"));
            if (allMembers) {
                // 旧全体记录没有接收账号，按该平台的在用机器人恢复；新记录保留账号。
                const bots = this.ctx.bots.filter(bot => bot.platform === event.platform &&
                    (details.selfId === undefined || bot.selfId === String(details.selfId)));
                const until = event.type.endsWith("-unban") ? 0 : Infinity;
                for (const bot of bots) this.updateMuteStatus(cid, until, bot.selfId, "all");
            } else if (this.ctx.bots.some(bot => bot.platform === event.platform && bot.selfId === userId)) {
                if (event.type === "guild-member-unban") this.updateMuteStatus(cid, 0, userId);
                else if (Number.isFinite(details.duration) && details.duration > 0)
                    this.updateMuteStatus(cid, event.timestamp.getTime() + details.duration, userId);
            }
        }
        this.logger.info("机器人禁言状态初始化完成");
    }

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
            TableName.Messages,
            {
                id: "string(255)",
                platform: "string(255)",
                channelId: "string(255)",
                sender: "json",
                timestamp: "timestamp",
                content: "text",
                quoteId: "string(255)",
            },
            { primary: ["id", "platform"] }
        );

        this.ctx.model.extend(
            TableName.L2Chunks,
            {
                id: "string(64)",
                platform: "string(255)",
                channelId: "string(255)",
                content: "text",
                embedding: "array",
                participantIds: "json",
                startTimestamp: "timestamp",
                endTimestamp: "timestamp",
            },
            { primary: "id" }
        );

        this.ctx.model.extend(
            TableName.L3Diaries,
            {
                id: "string(255)",
                date: "string(32)",
                platform: "string(255)",
                channelId: "string(255)",
                content: "text",
                keywords: "json",
                mentionedUserIds: "json",
            },
            { primary: "id" }
        );

        this.ctx.model.extend(
            TableName.SystemEvents,
            {
                id: "string(64)",
                platform: "string(255)",
                channelId: "string(255)",
                type: "string(255)",
                timestamp: "timestamp",
                payload: "json",
                message: "text",
            },
            { primary: "id" }
        );
    }

    private scheduleClearTask() {
        if (this.clearTimer) return; // 已经有定时任务在运行

        this.clearTimer = this.ctx.setInterval(() => {
            this.clear();
        }, this.config.cleanupIntervalSec * 1000);

        this.logger.info(`数据清理任务已启动，间隔 ${this.config.cleanupIntervalSec} 秒`);
    }

    private async clear() {
        try {
            const expiresAt = Date.now() - this.config.dataRetentionDays * 24 * 60 * 60 * 1000;

            await this.ctx.database.transact(async (db) => {
                await db.remove(TableName.Messages, { timestamp: { $lt: new Date(expiresAt) } });
                await db.remove(TableName.SystemEvents, { timestamp: { $lt: new Date(expiresAt) } });
                await db.remove(TableName.L2Chunks, { endTimestamp: { $lt: new Date(expiresAt) } });
            });

            await this.l1_manager.pruneOldData();
            this.logger.info("历史数据清理完成");
        } catch (err) {
            this.logger.error("历史数据清理失败", err);
        }
    }
}
