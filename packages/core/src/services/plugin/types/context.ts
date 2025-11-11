import { Bot, Session } from "koishi";

/**
 * Context capabilities that tools can request.
 */
export enum ContextCapability {
    Platform = "platform",
    ChannelId = "channelId",
    GuildId = "guildId",
    UserId = "userId",
    Bot = "bot",
    Session = "session",
    Timestamp = "timestamp",
    Metadata = "metadata",
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
}

/**
 * Tool execution context (replaces ToolRuntime).
 * Provides capability-based access to execution context.
 */
export interface ToolContext {
    /**
     * Check if a capability is available.
     */
    has<K extends ContextCapability>(capability: K): boolean;

    /**
     * Get a capability value (undefined if not available).
     */
    get<K extends ContextCapability>(capability: K): ContextCapabilityMap[K] | undefined;

    /**
     * Get a capability with fallback.
     */
    getOrDefault<K extends ContextCapability>(capability: K, defaultValue: ContextCapabilityMap[K]): ContextCapabilityMap[K];

    /**
     * Get multiple capabilities at once.
     */
    getMany<K extends ContextCapability>(...capabilities: K[]): Partial<Pick<ContextCapabilityMap, K>>;

    /**
     * Require a capability (throws if not available).
     */
    require<K extends ContextCapability>(capability: K): ContextCapabilityMap[K];
}
