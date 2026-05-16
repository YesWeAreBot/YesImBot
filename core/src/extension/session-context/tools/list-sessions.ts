import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod";

import { listSessionFiles, readChannelMeta, resolveChannelLocator } from "../channel-store.js";
import type { ChannelLocator, ListSessionsInput, SessionContextConfig } from "../types.js";

export function createListSessionsTool(
  config: SessionContextConfig,
  currentChannel: ChannelLocator | null,
): ToolDefinition {
  return {
    name: "list_sessions",
    description: "List session files for a single resolved channel.",
    promptSnippet: "List session files for one channel",
    inputSchema: z.object({
      current: z.boolean().optional(),
      platform: z.string().optional(),
      channelId: z.string().optional(),
      channelKey: z.string().optional(),
      limit: z.number().int().positive().optional(),
      sort: z.enum(["modified_desc", "modified_asc"]).optional(),
    }),
    execute: async (rawInput) => {
      const input = rawInput as ListSessionsInput;
      const locator = await resolveChannelLocator({
        sessionsDir: config.sessionsDir,
        isolation: config.isolation,
        currentChannel,
        current: input.current,
        platform: input.platform,
        channelId: input.channelId,
        channelKey: input.channelKey,
      });

      if ("error" in locator) return locator;

      const meta = await readChannelMeta(config.sessionsDir, locator.channelKey);
      const sessions = await listSessionFiles(
        config.sessionsDir,
        locator.channelKey,
        meta?.currentSessionId,
      );
      const limit = input.limit ?? sessions.length;
      const sorted = [...sessions].sort((left, right) =>
        right.modified.localeCompare(left.modified),
      );

      return {
        channel: {
          ...locator,
          type: meta?.type,
          currentSessionId: meta?.currentSessionId,
          sessionCount: meta?.sessionCount,
          lastActiveAt: meta?.updatedAt ?? meta?.lastActiveAt,
        },
        sessions: sorted.slice(0, limit),
        truncated: sorted.length > limit,
      };
    },
  };
}
