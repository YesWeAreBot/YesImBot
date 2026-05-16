import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod/v4";

import { listChannelSummaries, resolveChannelLocator } from "../channel-store.js";
import type { ChannelLocator, FindChannelsInput, SessionContextConfig } from "../types.js";

export function createFindChannelsTool(
  config: SessionContextConfig,
  currentChannel: ChannelLocator | null,
): ToolDefinition {
  return {
    name: "find_channels",
    description:
      "Discover channels and resolve channel locators from channel-map.json and meta.json.",
    promptSnippet: "Find candidate channels from session metadata",
    inputSchema: z.object({
      platform: z.string().optional(),
      channelId: z.string().optional(),
      channelIdQuery: z.string().optional(),
      channelKey: z.string().optional(),
      type: z.enum(["group", "private"]).optional(),
      limit: z.number().int().positive().optional(),
      sortBy: z.enum(["recent", "sessionCount"]).optional(),
    }),
    execute: async (rawInput) => {
      const input = rawInput as FindChannelsInput;
      const locator = await resolveChannelLocator({
        sessionsDir: config.sessionsDir,
        isolation: config.isolation,
        currentChannel,
        platform: input.platform,
        channelId: input.channelId,
        channelKey: input.channelKey,
      });

      if (config.isolation) {
        return "error" in locator
          ? locator
          : { channels: [{ ...locator, matchReason: "current-channel" }], truncated: false };
      }

      const limit = Math.min(input.limit ?? 10, 50);
      const summaries = await listChannelSummaries(config.sessionsDir);
      const filtered = summaries
        .filter((summary) => !input.platform || summary.platform === input.platform)
        .filter((summary) => !input.channelId || summary.channelId === input.channelId)
        .filter(
          (summary) => !input.channelIdQuery || summary.channelId.includes(input.channelIdQuery),
        )
        .filter((summary) => !input.type || summary.type === input.type)
        .sort((left, right) => (right.lastActiveAt ?? "").localeCompare(left.lastActiveAt ?? ""));

      return {
        channels: filtered.slice(0, limit),
        truncated: filtered.length > limit,
      };
    },
  };
}
