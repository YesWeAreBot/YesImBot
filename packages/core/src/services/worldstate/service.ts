import { Context, Service, Session } from "koishi";

import { Config } from "@/config";
import { Services, TableName } from "@/shared/constants";
import { HistoryCommandManager } from "./commands";
import { ContextBuilder } from "./context-builder";
import { EventListenerManager } from "./event-listener";
import { HistoryManager } from "./message-manager";
import {
    AgentStimulus,
    AnyAgentStimulus,
    AnyWorldState,
    BackgroundTaskCompletionStimulus,
    ChannelEventStimulus,
    EventData,
    GlobalEventStimulus,
    MemberData,
    MessagePayload,
    ScheduledTaskStimulus,
    UserMessageStimulus,
} from "./types";

declare module "koishi" {
    interface Context {
        [Services.WorldState]: WorldStateService;
    }
    interface Events {
        "agent/stimulus": (stimulus: AgentStimulus<any>) => void;
        "agent/stimulus-channel-event": (stimulus: ChannelEventStimulus) => void;
        "agent/stimulus-user-message": (stimulus: UserMessageStimulus) => void;
        "agent/stimulus-global-event": (stimulus: GlobalEventStimulus) => void;
        "agent/stimulus-scheduled-task": (stimulus: ScheduledTaskStimulus) => void;
        "agent/stimulus-background-task-completion": (stimulus: BackgroundTaskCompletionStimulus) => void;
    }
    interface Tables {
        [TableName.Members]: MemberData;
        [TableName.Events]: EventData;
    }
}

export class WorldStateService extends Service<Config> {
    static readonly inject = [Services.Model, Services.Asset, Services.Prompt, Services.Memory, "database"];

    private history: HistoryManager;
    private contextBuilder: ContextBuilder;
    private eventListenerManager: EventListenerManager;
    private commandManager: HistoryCommandManager;

    private clearTimer: ReturnType<Context["setInterval"]> | null = null;

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.WorldState, true);
        this.config = config;

        this.history = new HistoryManager(ctx);
        this.contextBuilder = new ContextBuilder(ctx, config, this.history);
        this.eventListenerManager = new EventListenerManager(ctx, this, config);
        this.commandManager = new HistoryCommandManager(ctx, this, config);
    }

    protected async start(): Promise<void> {
        this.registerModels();

        this.eventListenerManager.start();
        this.commandManager.register();

        this.ctx.logger.info("服务已启动");
    }

    protected stop(): void {
        this.eventListenerManager.stop();
        if (this.clearTimer) {
            this.clearTimer();
        }
        this.ctx.logger.info("服务已停止");
    }

    public async buildWorldState(stimulus: AnyAgentStimulus): Promise<AnyWorldState> {
        return await this.contextBuilder.buildFromStimulus(stimulus);
    }

    /* prettier-ignore */
    public async recordMessage(message: MessagePayload & { platform: string; channelId: string; }): Promise<void> {
        await this.ctx.database.create(TableName.Events, {
            type: "message",
            platform: message.platform,
            channelId: message.channelId,
            payload: {
                sender: message.sender,
                content: message.content,
                quoteId: message.quoteId,
            },
        });
    }

    public isChannelAllowed(session: Session): boolean {
        const { platform, channelId, guildId, isDirect, userId } = session;
        return this.config.allowedChannels.some((c) => {
            return (
                c.platform === platform &&
                (c.type === "private" ? isDirect : true) &&
                (c.id === "*" || c.id === channelId || (guildId && c.id === guildId) || (c.type === "private" && c.id === userId))
            );
        });
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
            TableName.Events,
            {
                id: "string(255)",
                type: "string(50)",
                timestamp: "timestamp",
                platform: "string(255)",
                channelId: "string(255)",
                payload: "json",
            },
            { primary: "id" }
        );
    }
}
