import { Context } from "koishi";

import { AnyAgentStimulus, StimulusSource } from "@/services/worldstate";
import { ContextCapability, ContextCapabilityMap, ToolContext } from "../types";
import { ToolContextProvider } from "./provider";

/**
 * Adapter that converts AnyAgentStimulus to ToolContext.
 * This is the ONLY place where the Extension system touches WorldState types.
 */
export class StimulusContextAdapter {
    constructor(private ctx: Context) {}

    /**
     * Create ToolContext from stimulus.
     */
    fromStimulus(stimulus: AnyAgentStimulus, extras?: Partial<ContextCapabilityMap>): ToolContext {
        const provider = new ToolContextProvider();

        // Always available
        provider.set(ContextCapability.Timestamp, stimulus.timestamp);

        // Extract based on stimulus type
        switch (stimulus.type) {
            case StimulusSource.UserMessage: {
                const { platform, channelId, guildId, userId, bot } = stimulus.payload;
                provider
                    .set(ContextCapability.Platform, platform)
                    .set(ContextCapability.ChannelId, channelId)
                    .set(ContextCapability.Bot, bot)
                    .set(ContextCapability.Session, stimulus.payload);

                if (guildId) provider.set(ContextCapability.GuildId, guildId);
                if (userId) provider.set(ContextCapability.UserId, userId);
                break;
            }

            case StimulusSource.ChannelEvent: {
                const { platform, channelId } = stimulus.payload;
                if (platform) provider.set(ContextCapability.Platform, platform);
                if (channelId) provider.set(ContextCapability.ChannelId, channelId);
                break;
            }

            case StimulusSource.ScheduledTask:
            case StimulusSource.BackgroundTaskCompletion: {
                const { platform, channelId } = stimulus.payload;
                if (platform) {
                    provider.set(ContextCapability.Platform, platform);
                    const bot = this.ctx.bots.find((b) => b.platform === platform);
                    if (bot) provider.set(ContextCapability.Bot, bot);
                }
                if (channelId) provider.set(ContextCapability.ChannelId, channelId);
                break;
            }

            case StimulusSource.GlobalEvent:
            case StimulusSource.SelfInitiated:
                // Global events have no channel/platform context
                break;
        }

        // Apply extras
        if (extras) {
            for (const [key, value] of Object.entries(extras)) {
                if (value !== undefined) {
                    provider.set(key as ContextCapability, value);
                }
            }
        }

        return provider;
    }

    /**
     * Create ToolContext from direct parameters (for testing/programmatic use).
     */
    fromParams(params: Partial<ContextCapabilityMap>): ToolContext {
        return new ToolContextProvider(params);
    }
}
