import { join } from "node:path";

import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod/v4";

import { resolveChannelLocator } from "../channel-store.js";
import { readJsonlWindow } from "../jsonl-parser.js";
import type { ChannelLocator, ReadSessionWindowInput, SessionContextConfig } from "../types.js";

export function createReadSessionWindowTool(
  config: SessionContextConfig,
  currentChannel: ChannelLocator | null,
): ToolDefinition {
  return {
    name: "read_session_window",
    description: "Read a small message window around a known session hit.",
    promptSnippet: "Read session context around a timestamp or matched phrase",
    inputSchema: z.object({
      current: z.boolean().optional(),
      platform: z.string().optional(),
      channelId: z.string().optional(),
      channelKey: z.string().optional(),
      sessionId: z.string(),
      anchorTimestamp: z.string().optional(),
      anchorQuery: z.string().optional(),
      before: z.number().int().nonnegative().optional(),
      after: z.number().int().nonnegative().optional(),
      messageTypes: z.array(z.enum(["user", "assistant", "session"])).optional(),
    }),
    execute: async (rawInput) => {
      const input = rawInput as ReadSessionWindowInput;

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

      const filePath = join(config.sessionsDir, locator.channelKey, `${input.sessionId}.jsonl`);
      const result = await readJsonlWindow(filePath, {
        anchorTimestamp: input.anchorTimestamp,
        anchorQuery: input.anchorQuery,
        before: input.before ?? 5,
        after: input.after ?? 10,
        messageTypes: new Set(input.messageTypes ?? ["user", "assistant"]),
      });

      return {
        channel: locator,
        sessionId: input.sessionId,
        anchorFound: result.anchorFound,
        window: result.window,
        truncated: result.truncated,
      };
    },
  };
}
