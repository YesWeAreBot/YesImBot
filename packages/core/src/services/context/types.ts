import type { Bot, Session } from "koishi";

import type { AnyWorldState, ChannelWorldState, GlobalWorldState, L1HistoryItem } from "@/services/worldstate/types";

/**
 * Context capabilities that tools can request.
 * This is the contract between WorldState and Plugin modules.
 */
export enum ContextCapability {
    // === Basic capabilities (available in both channel and global contexts) ===
    /** Platform identifier (e.g., "discord", "telegram") */
    Platform = "platform",
    /** Channel ID */
    ChannelId = "channelId",
    /** Guild/Server ID */
    GuildId = "guildId",
    /** User ID who triggered the stimulus */
    UserId = "userId",
    /** Bot instance */
    Bot = "bot",
    /** Koishi session object (only for UserMessage stimulus) */
    Session = "session",
    /** Timestamp of the stimulus */
    Timestamp = "timestamp",
    /** Generic metadata storage */
    Metadata = "metadata",

    // === WorldState-aware capabilities ===
    /** Complete WorldState object */
    WorldState = "worldState",
    /** Context type: "channel" or "global" */
    ContextType = "contextType",

    // === Channel-specific capabilities ===
    /** L1 history (only in channel context) */
    History = "history",
    /** Channel information (only in channel context) */
    ChannelInfo = "channelInfo",

    // === Global-specific capabilities ===
    /** Global scope data (only in global context) */
    GlobalScope = "globalScope",
}

/**
 * Global scope data available in global context.
 */
export interface GlobalScopeData {
    /** Active channels summary */
    activeChannels?: Array<{
        platform: string;
        channelId: string;
        name: string;
        lastActivity: Date;
    }>;

    /** Retrieved L2 memories (future) */
    recentMemories?: any[];

    /** L3 diary entries for reflection (future) */
    diaryEntries?: any[];
}

/**
 * Maps capabilities to their TypeScript types.
 */
export interface ContextCapabilityMap {
    [ContextCapability.Platform]: string;
    [ContextCapability.ChannelId]: string;
    [ContextCapability.GuildId]: string;
    [ContextCapability.UserId]: string;
    [ContextCapability.Bot]: Bot;
    [ContextCapability.Session]: Session;
    [ContextCapability.Timestamp]: Date;
    [ContextCapability.Metadata]: Record<string, unknown>;
    [ContextCapability.WorldState]: AnyWorldState;
    [ContextCapability.ContextType]: "channel" | "global";
    [ContextCapability.History]: L1HistoryItem[];
    [ContextCapability.ChannelInfo]: ChannelWorldState["channel"];
    [ContextCapability.GlobalScope]: GlobalScopeData;
}

/**
 * Tool context interface - provides capability-based access to context data.
 */
export interface ToolContext {
    /**
     * Get a capability value.
     * @throws Error if capability is not available
     */
    get: <K extends ContextCapability>(capability: K) => ContextCapabilityMap[K];

    /**
     * Try to get a capability value.
     * @returns The value or undefined if not available
     */
    tryGet: <K extends ContextCapability>(capability: K) => ContextCapabilityMap[K] | undefined;

    /**
     * Check if a capability is available.
     */
    has: (capability: ContextCapability) => boolean;

    /**
     * Set a capability value (for internal use).
     */
    set: <K extends ContextCapability>(capability: K, value: ContextCapabilityMap[K]) => void;

    /**
     * Require a capability (throws if not available).
     */
    require: <K extends ContextCapability>(capability: K) => ContextCapabilityMap[K];
}
