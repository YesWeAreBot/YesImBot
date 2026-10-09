import { createHash, randomUUID } from "node:crypto";

import { Context, Service, Session } from "koishi";

import { Config } from "../../config";
import { Services, TableName } from "../../shared/constants";
import { sanitizeDiagnostic } from "../../shared/diagnostic-sanitizer";
import { HISTORY_CHANNELS, MESSAGE_KEY_MIGRATION, registerChannelModel, sessionChannelType } from "./channel-metadata";
import { HistoryCommandManager } from "./commands";
import { ContextBuilder } from "./context-builder";
import { EventListenerManager } from "./event-listener";
import { InteractionManager } from "./interaction-manager";
import { SemanticMemoryManager } from "./l2-semantic-memory";
import { ArchivalMemoryManager } from "./l3-archival-memory";
import { recallStoredMemories, type StoredRecallOptions } from "./recall";
import { AgentStimulus, BotMuteStateData, DiaryEntryData, MemberData, MemoryChunkData, MessageData, SystemEventData, WorldState } from "./types";

declare module "koishi" {
    interface Context {
        [Services.WorldState]: WorldStateService;
    }
    interface Events {
        "yesimbot/before-user-stimulus": (session: Session) => void | Promise<void>;
        "yesimbot/filter-recalled-memory": (session: Session, state: any) => void | Promise<void>;
        "agent/stimulus": (stimulus: AgentStimulus<any>) => void;
        "agent/bot-muted": (target: { platform: string; selfId: string; channelId: string }) => void;
    }
    interface Tables {
        [TableName.Members]: MemberData;
        [TableName.Messages]: MessageData;
        [TableName.SystemEvents]: SystemEventData;
        [TableName.BotMuteState]: BotMuteStateData;
        [TableName.L2Chunks]: MemoryChunkData;
        [TableName.L3Diaries]: DiaryEntryData;
    }
}

export class WorldStateService extends Service<Config> {
    /** Extension contract v1; feature detection also supports source checkouts. */
    public get capabilities() {
        return Object.freeze({
            beforeUserStimulus: 1 as const,
            memoryCorrectionFilter: 1 as const,
            memoryRecall: 1 as const,
            frameworkEventDetails: 1 as const,
        });
    }

    static readonly inject = [Services.Model, Services.Asset, Services.Logger, Services.Prompt, Services.Memory, "database"];

    public l1_manager: InteractionManager;
    public l2_manager: SemanticMemoryManager;
    public l3_manager: ArchivalMemoryManager;

    private contextBuilder: ContextBuilder;
    private eventListenerManager: EventListenerManager;
    private commandManager: HistoryCommandManager;
    private readonly mutedChannels = new Map<string, number>();
    private readonly allMutedChannels = new Map<string, number>();
    private muteWrites?: Promise<void>;

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
        await this.migrateMessagePrimaryKey();
        for (const channel of await this.ctx.database.get(HISTORY_CHANNELS, {})) {
            if (channel.channelType) this.l2_manager.observeChannel({ platform: channel.platform, channelId: channel.channelId }, channel.channelType);
        }
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
        await Promise.all([this.l2_manager.stop(), stoppingDiaries, this.muteWrites]);
        this.logger.info("服务已停止");
    }

    public async getFrameworkEvents(memoryDomain: string) {
        const events = await this.ctx.database.get(
            TableName.SystemEvents,
            { eventScope: "mind", botKey: memoryDomain },
            { limit: 8, sort: { timestamp: "desc" } },
        );
        return events.map((e) => ({
            id: e.id,
            type: e.type,
            timestamp: e.timestamp,
            platform: e.platform,
            channelId: e.channelId,
            eventScope: e.eventScope,
            payload: JSON.stringify(sanitizeDiagnostic(e.payload)).slice(0, 1600),
        }));
    }

    public recallMemory(options: StoredRecallOptions) {
        return recallStoredMemories(this.ctx.database, options);
    }

    public async buildWorldState(session: Session): Promise<WorldState> {
        const state = await this.contextBuilder.build(session);
        await this.ctx.parallel("yesimbot/filter-recalled-memory", session, state);
        return state;
    }

    /** Channel identity comes from the adapter, never from an ID prefix. */
    public async observeChannel(session: Session): Promise<void> {
        const channelType = sessionChannelType(session);
        if (!channelType || !session.platform || !session.channelId) return;
        const target = { platform: session.platform, channelId: session.channelId };
        this.l2_manager.observeChannel(target, channelType);
        await this.ctx.database.upsert(HISTORY_CHANNELS, [{ ...target, channelType }]);
    }

    public async recordMessage(message: MessageData): Promise<void> {
        if (message.channelType) this.l2_manager.observeChannel(message, message.channelType);
        // 在 L1 异步写入之前登记代次与在途任务，清除必须等待已接受的写入。
        const generation = this.l2_manager.getHistoryGeneration(message);
        const recorded = await this.l2_manager.writeMemory(message, generation, () => this.l1_manager.recordMessage(message));
        if (recorded && this.l2_manager.getHistoryGeneration(message) === generation && this.config.l2_memory.enabled) {
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
        if (event.channelType) this.l2_manager.observeChannel(event, event.channelType);
        const generation = this.l2_manager.getHistoryGeneration(event);
        await this.l2_manager.writeMemory(event, generation, () => this.l1_manager.recordSystemEvent(event));
    }

    /** 查询使用纯读取，不清除到期状态。 */
    public peekBotMuted(channelCid: string, selfId?: string): boolean {
        const now = Date.now();
        return this.muteKeys(channelCid, selfId).some((key) => (this.mutedChannels.get(key) || 0) > now || (this.allMutedChannels.get(key) || 0) > now);
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
        return [cid, ...new Set([...this.mutedChannels.keys(), ...this.allMutedChannels.keys()].filter((key) => key.startsWith(prefix)))];
    }

    public updateMuteStatus(cid: string, expiresAt: number, selfId?: string, kind: "individual" | "all" = "individual"): Promise<void> {
        this.applyMuteStatus(cid, expiresAt, selfId, kind);
        return this.persistMuteStates([this.muteState(cid, expiresAt, selfId, kind)]);
    }

    private muteState(cid: string, expiresAt: number, selfId: string | undefined, kind: "individual" | "all"): BotMuteStateData {
        return {
            id: createHash("sha256")
                .update(JSON.stringify([cid, selfId ?? null, kind]))
                .digest("hex"),
            channelCid: cid,
            selfId: selfId ?? "",
            kind,
            expiresAt: Number.isFinite(expiresAt) && expiresAt > Date.now() ? expiresAt : 0,
            permanent: expiresAt === Infinity,
        };
    }

    private persistMuteStates(states: BotMuteStateData[]): Promise<void> {
        // 失败仍由当前调用方观察；后续更新可以恢复队列，不能永久被一次故障阻塞。
        const task = (this.muteWrites || Promise.resolve())
            .catch(() => {})
            .then(async () => {
                await this.ctx.database.upsert(TableName.BotMuteState, states, ["id"]);
            });
        this.muteWrites = task;
        void task.catch((error) => this.logger.error("持久化机器人禁言状态失败", error));
        return task;
    }

    private applyMuteStatus(cid: string, expiresAt: number, selfId?: string, kind: "individual" | "all" = "individual"): void {
        const key = selfId === undefined ? cid : JSON.stringify([cid, selfId]);
        const states = kind === "all" ? this.allMutedChannels : this.mutedChannels;
        if (expiresAt > Date.now()) {
            states.set(key, expiresAt);
            this.logger.debug(
                `[${cid}] Bot[${selfId ?? "*"}] | 已被禁言 | 解封时间: ${expiresAt === Infinity ? "永久" : new Date(expiresAt).toLocaleString()}`,
            );
            const separator = cid.indexOf(":");
            const platform = cid.slice(0, separator);
            const channelId = cid.slice(separator + 1);
            const ids = selfId === undefined ? this.ctx.bots.filter((bot) => bot.platform === platform).map((bot) => bot.selfId) : [selfId];
            for (const id of ids) this.ctx.emit("agent/bot-muted", { platform, selfId: id, channelId });
        } else {
            states.delete(key);
            this.logger.debug(`[${cid}] Bot[${selfId ?? "*"}] | ${kind === "all" ? "全体" : "单独"}禁言状态已解除`);
        }
    }

    private async initializeMuteStatus(): Promise<void> {
        this.logger.info("正在初始化机器人禁言状态...");
        const states = await this.ctx.database.get(TableName.BotMuteState, {});
        const persisted = new Set(states.map((state) => state.id));
        for (const state of states) {
            this.applyMuteStatus(state.channelCid, state.permanent ? Infinity : state.expiresAt, state.selfId || undefined, state.kind);
        }
        // 旧事件仅用于迁移尚无当前状态的键；解除墓碑不能被残留历史覆盖。
        const migrated = new Map<string, BotMuteStateData>();
        const migrate = (cid: string, until: number, selfId: string, kind: "individual" | "all" = "individual") => {
            const state = this.muteState(cid, until, selfId, kind);
            if (!persisted.has(state.id)) migrated.set(state.id, state);
        };
        const events = await this.ctx.database.get(TableName.SystemEvents, {
            type: { $in: ["guild-member-ban", "guild-member-unban", "guild-all-member-ban", "guild-all-member-unban"] },
        });
        events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        for (const event of events) {
            const details = (event.payload as any)?.details;
            if (!details) continue;
            const cid = `${event.platform}:${event.channelId}`;
            const userId = details.user?.id === undefined ? undefined : String(details.user.id);
            const allMembers = event.type.startsWith("guild-all-member-") || (event.type === "guild-member-unban" && (userId === undefined || userId === "0"));
            if (allMembers) {
                // 旧全体记录没有接收账号，按该平台的在用机器人恢复；新记录保留账号。
                const bots = this.ctx.bots.filter(
                    (bot) => bot.platform === event.platform && (details.selfId === undefined || bot.selfId === String(details.selfId)),
                );
                const until = event.type.endsWith("-unban") ? 0 : Infinity;
                for (const bot of bots) migrate(cid, until, bot.selfId, "all");
            } else if (this.ctx.bots.some((bot) => bot.platform === event.platform && bot.selfId === userId)) {
                if (event.type === "guild-member-unban") migrate(cid, 0, userId!);
                else if (Number.isFinite(details.duration) && details.duration > 0) migrate(cid, event.timestamp.getTime() + details.duration, userId!);
            }
        }
        if (migrated.size) {
            for (const state of migrated.values()) {
                this.applyMuteStatus(state.channelCid, state.permanent ? Infinity : state.expiresAt, state.selfId || undefined, state.kind);
            }
            this.persistMuteStates([...migrated.values()]);
            await this.muteWrites;
        }
        this.logger.info("机器人禁言状态初始化完成");
    }

    /** Minato SQLite does not detect primary-key-only changes. Adding then retiring
     * a migration column invokes its supported, copy-before-drop schema migration.
     * The durable marker prevents rebuilding history on subsequent starts. */
    private async migrateMessagePrimaryKey(): Promise<void> {
        const [marker] = await this.ctx.database.get(HISTORY_CHANNELS, MESSAGE_KEY_MIGRATION);
        if (marker?.messageKeyVersion === 2) return;
        const migrationField = "_messageKeyMigration";
        this.ctx.model.extend(TableName.Messages, { [migrationField]: "boolean" } as any);
        await this.ctx.database.prepared();
        this.ctx.model.migrate(TableName.Messages, { [migrationField]: "boolean" } as any, async () => {});
        await this.ctx.database.prepared();
        // Some drivers report migration failures through their logger rather than
        // rejecting prepared(). Verify the old uniqueness is gone before marking
        // completion; cleanup is limited to these randomly identified probe rows.
        const probeId = randomUUID();
        const platform = "__yesimbot_message_key_migration__";
        const probe = { id: probeId, platform, sender: { id: "" }, timestamp: new Date(), content: "" };
        try {
            await this.ctx.database.create(TableName.Messages, { ...probe, channelId: `${probeId}:a` });
            await this.ctx.database.create(TableName.Messages, { ...probe, channelId: `${probeId}:b` });
        } finally {
            await this.ctx.database.remove(TableName.Messages, { platform, id: probeId });
        }
        await this.ctx.database.upsert(HISTORY_CHANNELS, [{ ...MESSAGE_KEY_MIGRATION, channelType: "", messageKeyVersion: 2 }]);
    }

    private registerModels(): void {
        registerChannelModel(this.ctx);
        this.ctx.model.extend(
            TableName.BotMuteState,
            {
                id: "string(64)",
                channelCid: "string(511)",
                selfId: "string(255)",
                kind: "string(16)",
                expiresAt: "double",
                permanent: "boolean",
            },
            { primary: "id" },
        );
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
            { autoInc: false, primary: ["pid", "platform", "guildId"] },
        );

        this.ctx.model.extend(
            TableName.Messages,
            {
                id: "string(255)",
                platform: "string(255)",
                channelId: "string(255)",
                channelType: "string(16)",
                sender: "json",
                timestamp: "timestamp",
                content: "text",
                quoteId: "string(255)",
            },
            { primary: ["platform", "channelId", "id"] },
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
            { primary: "id" },
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
            { primary: "id" },
        );

        this.ctx.model.extend(
            TableName.SystemEvents,
            {
                id: "string(64)",
                platform: "string(255)",
                channelId: "string(255)",
                type: "string(255)",
                channelType: "string(16)",
                timestamp: "timestamp",
                eventScope: "string(16)",
                botKey: "string(255)",
                payload: "json",
                message: "text",
            },
            { primary: "id" },
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

            // Each retention deletion is idempotent and retried next run on
            // failure. A shared SQLite transaction could roll back unrelated
            // ordinary writes accepted while cleanup awaits its next deletion.
            await this.ctx.database.remove(TableName.Messages, { timestamp: { $lt: new Date(expiresAt) } });
            await this.ctx.database.remove(TableName.SystemEvents, { timestamp: { $lt: new Date(expiresAt) } });
            await this.ctx.database.remove(TableName.L2Chunks, { endTimestamp: { $lt: new Date(expiresAt) } });

            await this.l1_manager.pruneOldData();
            this.logger.info("历史数据清理完成");
        } catch (error) {
            this.logger.error("历史数据清理失败", error);
        }
    }
}
