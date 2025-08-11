import { Context, Service, Session } from "koishi";

import { Services, TableName } from "@/shared/constants";
import { HistoryCommandManager } from "./commands";
import { HistoryConfig } from "./config";
import { ContextBuilder } from "./context-builder";
import { EventListenerManager } from "./event-listener";
import { InteractionManager } from "./interaction-manager";
import { SemanticMemoryManager } from "./l2-semantic-memory";
import { ArchivalMemoryManager } from "./l3-archival-memory";
import { AgentStimulus, DiaryEntryData, MemberData, MemoryChunkData, MessageData, SystemEventData, WorldState } from "./types";

export * from "./config";
export * from "./types";

declare module "koishi" {
    interface Context {
        [Services.WorldState]: WorldStateService;
    }
    interface Events {
        "agent/stimulus": (stimulus: AgentStimulus<any>) => void;
    }
    interface Tables {
        [TableName.Members]: MemberData;
        [TableName.Messages]: MessageData;
        [TableName.SystemEvents]: SystemEventData;
        [TableName.L2Chunks]: MemoryChunkData;
        [TableName.L3Diaries]: DiaryEntryData;
    }
}

export class WorldStateService extends Service<HistoryConfig> {
    static readonly inject = [Services.Model, Services.Asset, Services.Logger, Services.Prompt, Services.Memory, "database"];

    public l1_manager: InteractionManager;
    public l2_manager: SemanticMemoryManager;
    public l3_manager: ArchivalMemoryManager;

    private contextBuilder: ContextBuilder;
    private eventListenerManager: EventListenerManager;
    private commandManager: HistoryCommandManager;
    private readonly mutedChannels = new Map<string, number>(); // Key: channelCid, Value: mute expiration timestamp

    constructor(ctx: Context, config: HistoryConfig) {
        super(ctx, Services.WorldState, true);
        this.config = config;
        this.logger = this.ctx[Services.Logger].getLogger("[世界状态]");

        // Initialize all managers
        this.l1_manager = new InteractionManager(ctx, config);
        this.l2_manager = new SemanticMemoryManager(ctx, config);
        this.l3_manager = new ArchivalMemoryManager(ctx, config, this.l1_manager);
        this.contextBuilder = new ContextBuilder(ctx, config, this.l1_manager, this.l2_manager, this.l3_manager);
        this.eventListenerManager = new EventListenerManager(ctx, this, config);
        this.commandManager = new HistoryCommandManager(ctx, this, config);
    }

    protected async start(): Promise<void> {
        this.registerModels();
        await this.initializeMuteStatus();

        // Start sub-services
        this.l2_manager.start();
        this.l3_manager.start();
        this.eventListenerManager.start();
        this.commandManager.register();

        this.logger.info("服务已启动");
    }

    protected stop(): void {
        this.eventListenerManager.stop();
        this.l2_manager.stop();
        this.l3_manager.stop();
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
        const { platform, channelId, guildId, isDirect } = session;
        return this.config.allowedChannels.some((c) => {
            return (
                c.platform === platform && c.isDirect === isDirect && (c.id === "*" || c.id === channelId || (guildId && c.id === guildId))
            );
        });
    }

    public async recordSystemEvent(event: SystemEventData): Promise<void> {
        await this.l1_manager.recordSystemEvent(event);
    }

    public isBotMuted(channelCid: string): boolean {
        const expiresAt = this.mutedChannels.get(channelCid);
        if (!expiresAt) return false;

        if (Date.now() > expiresAt) {
            this.mutedChannels.delete(channelCid);
            return false;
        }

        return true;
    }

    public updateMuteStatus(cid: string, expiresAt: number): void {
        if (expiresAt > Date.now()) {
            this.mutedChannels.set(cid, expiresAt);
            this.logger.debug(`[${cid}] | 已被禁言 | 解封时间: ${new Date(expiresAt).toLocaleString()}`);
        } else {
            this.mutedChannels.delete(cid);
            this.logger.debug(`[${cid}] | 禁言状态已解除`);
        }
    }

    private async initializeMuteStatus(): Promise<void> {
        this.logger.info("正在从历史记录初始化机器人禁言状态...");
        const allBanEvents = await this.ctx.database.get(TableName.SystemEvents, {
            type: "guild-member-ban",
        });

        const botIds = new Set(this.ctx.bots.map((b) => b.selfId));
        const relevantEvents = allBanEvents.filter((event) => {
            const payload = event.payload as any;
            return botIds.has(payload.details?.user?.id);
        });

        const now = Date.now();
        for (const event of relevantEvents) {
            const payload = event.payload as any;
            const duration = payload.details?.duration;
            if (duration > 0) {
                const expiresAt = event.timestamp.getTime() + duration;
                if (expiresAt > now) {
                    const channelCid = `${event.platform}:${event.channelId}`;
                    this.updateMuteStatus(channelCid, expiresAt);
                }
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
            { primary: "id" }
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
                renderedMessage: "text",
            },
            { primary: "id" }
        );
    }
}
