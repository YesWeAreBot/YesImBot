import type { Context } from "koishi";
import type { ContextCapabilityMap } from "./types";
import type { AnyAgentStimulus, AnyWorldState, ChannelWorldState, GlobalWorldState } from "@/services/worldstate";

import { StimulusSource } from "@/services/worldstate";
import { ContextCapability } from "./types";

/**
 * ContextCollector extracts ContextCapabilities from WorldState.
 * This is the bridge between WorldState module and Context module.
 *
 * Responsibility:
 * - WorldState module builds the "objective world snapshot"
 * - ContextCollector transforms it into "capabilities available to tools"
 * - ToolContextProvider provides the interface for tools to access these capabilities
 */
export class ContextCollector {
    constructor(private ctx: Context) {}

    /**
     * Collect context capabilities from WorldState and Stimulus.
     * This is the ONLY transformation point from WorldState → Context.
     *
     * @param worldState The world state snapshot
     * @param stimulus The stimulus that triggered this context
     * @returns Partial map of available capabilities
     */
    collectFromWorldState(
        worldState: AnyWorldState,
        stimulus: AnyAgentStimulus,
    ): Partial<ContextCapabilityMap> {
        const capabilities: Partial<ContextCapabilityMap> = {
            // Always available
            [ContextCapability.WorldState]: worldState,
            [ContextCapability.ContextType]: worldState.contextType,
            [ContextCapability.Timestamp]: stimulus.timestamp,
        };

        // Collect based on context type
        if (worldState.contextType === "channel") {
            this.collectChannelCapabilities(capabilities, worldState as ChannelWorldState, stimulus);
        }
        else if (worldState.contextType === "global") {
            this.collectGlobalCapabilities(capabilities, worldState as GlobalWorldState, stimulus);
        }

        // Collect stimulus-specific capabilities
        this.collectStimulusCapabilities(capabilities, stimulus);

        return capabilities;
    }

    /**
     * Collect capabilities specific to channel context.
     */
    private collectChannelCapabilities(
        capabilities: Partial<ContextCapabilityMap>,
        channelState: ChannelWorldState,
        stimulus: AnyAgentStimulus,
    ): void {
        // Channel information
        capabilities[ContextCapability.Platform] = channelState.channel.platform;
        capabilities[ContextCapability.ChannelId] = channelState.channel.id;
        capabilities[ContextCapability.ChannelInfo] = channelState.channel;

        if (channelState.channel.guildId) {
            capabilities[ContextCapability.GuildId] = channelState.channel.guildId;
        }

        // L1 History
        if (channelState.history && channelState.history.length > 0) {
            capabilities[ContextCapability.History] = channelState.history;
        }

        // TODO: L2 Retrieved Memories (future)
        // if (channelState.l2_retrieved_memories) {
        //     capabilities[ContextCapability.L2RetrievedMemories] = channelState.l2_retrieved_memories;
        // }
    }

    /**
     * Collect capabilities specific to global context.
     */
    private collectGlobalCapabilities(
        capabilities: Partial<ContextCapabilityMap>,
        globalState: GlobalWorldState,
        stimulus: AnyAgentStimulus,
    ): void {
        // Global scope data
        capabilities[ContextCapability.GlobalScope] = {
            activeChannels: globalState.activeChannels,
            // TODO: Add more global scope data as needed
        };
    }

    /**
     * Collect capabilities from stimulus payload.
     */
    private collectStimulusCapabilities(
        capabilities: Partial<ContextCapabilityMap>,
        stimulus: AnyAgentStimulus,
    ): void {
        // Metadata storage for stimulus-specific data
        const metadata: Record<string, unknown> = {
            stimulusType: stimulus.type,
        };

        switch (stimulus.type) {
            case StimulusSource.UserMessage: {
                const { platform, channelId, guildId, userId, bot } = stimulus.payload;

                // Override/set basic capabilities from stimulus
                capabilities[ContextCapability.Platform] = platform;
                capabilities[ContextCapability.ChannelId] = channelId;
                capabilities[ContextCapability.Bot] = bot;
                capabilities[ContextCapability.Session] = stimulus.payload;

                if (guildId) {
                    capabilities[ContextCapability.GuildId] = guildId;
                }
                if (userId) {
                    capabilities[ContextCapability.UserId] = userId;
                }

                // Add to metadata
                metadata.messageContent = stimulus.payload.content;
                break;
            }

            case StimulusSource.ChannelEvent: {
                const { platform, channelId, eventType } = stimulus.payload;
                if (platform) {
                    capabilities[ContextCapability.Platform] = platform;
                }
                if (channelId) {
                    capabilities[ContextCapability.ChannelId] = channelId;
                }
                metadata.eventType = eventType;
                break;
            }

            case StimulusSource.ScheduledTask:
            case StimulusSource.BackgroundTaskCompletion: {
                const { platform, channelId } = stimulus.payload;
                if (platform) {
                    capabilities[ContextCapability.Platform] = platform;
                    // Try to find bot for this platform
                    const bot = this.ctx.bots.find(b => b.platform === platform);
                    if (bot) {
                        capabilities[ContextCapability.Bot] = bot;
                    }
                }
                if (channelId) {
                    capabilities[ContextCapability.ChannelId] = channelId;
                }
                break;
            }

            case StimulusSource.GlobalEvent:
            case StimulusSource.SelfInitiated:
                // Global events have no channel/platform context
                break;
        }

        capabilities[ContextCapability.Metadata] = metadata;
    }
}
