import { join } from "node:path";

import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod/v4";

import {
  listChannelSummaries,
  listSessionFiles,
  readChannelMeta,
  resolveChannelLocator,
} from "../channel-store.js";
import { scanJsonlFile } from "../jsonl-parser.js";
import type {
  ChannelLocator,
  FilteredStats,
  SearchSessionInput,
  SessionContextConfig,
} from "../types.js";

function parseDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? undefined : ts;
}

export function createSearchSessionTool(
  config: SessionContextConfig,
  currentChannel: ChannelLocator | null,
): ToolDefinition {
  return {
    name: "search_session",
    description:
      "Search historical session messages within current channel, a resolved channel, or shared-mode global scope.",
    promptSnippet: "Search session history with query, sender, and time filters",
    inputSchema: z.object({
      query: z.string().optional(),
      isRegex: z.boolean().optional(),
      scope: z.enum(["current", "channel", "global"]).optional(),
      platform: z.string().optional(),
      channelId: z.string().optional(),
      channelKey: z.string().optional(),
      senderId: z.string().optional(),
      senderQuery: z.string().optional(),
      messageTypes: z.array(z.enum(["user", "assistant", "session"])).optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      sessionId: z.string().optional(),
      limit: z.number().int().positive().optional(),
      channelLimit: z.number().int().positive().optional(),
      sort: z.enum(["asc", "desc"]).optional(),
      keyword: z.string().optional(),
      user: z.string().optional(),
    }),
    execute: async (rawInput) => {
      const input = rawInput as SearchSessionInput;
      const query = input.query ?? input.keyword;
      const senderId = input.senderId ?? input.user;
      const scope =
        input.scope ??
        (input.platform || input.channelId || input.channelKey ? "channel" : "current");

      if (scope === "global" && config.isolation) {
        return {
          error: "Isolation mode only allows current channel.",
          code: "ISOLATION_VIOLATION",
          hint: "Search current channel or disable isolation mode.",
        };
      }

      if (
        scope === "global" &&
        !query &&
        !senderId &&
        !input.senderQuery &&
        !input.since &&
        !input.until
      ) {
        return {
          error: "Global session search requires at least one narrowing filter.",
          code: "QUERY_TOO_BROAD",
          hint: "Add query, senderId, senderQuery, since, or until.",
        };
      }

      const matcher = !query
        ? undefined
        : input.isRegex
          ? new RegExp(query, "i")
          : {
              test: (content: string) => content.toLowerCase().includes(query.toLowerCase()),
            };

      const targets =
        scope === "global"
          ? (await listChannelSummaries(config.sessionsDir)).slice(0, input.channelLimit ?? 10)
          : [
              await resolveChannelLocator({
                sessionsDir: config.sessionsDir,
                isolation: config.isolation,
                currentChannel,
                current: scope === "current",
                platform: input.platform,
                channelId: input.channelId,
                channelKey: input.channelKey,
              }),
            ];

      if (targets.some((target) => "error" in target)) {
        return targets.find((target) => "error" in target);
      }

      const limit = Math.min(input.limit ?? config.defaultLimit, config.maxLimit);
      const results: Array<{
        timestamp: string;
        type: string;
        senderId?: string;
        content: string;
        platform: string;
        channelId: string;
        channelKey: string;
        sessionId: string;
      }> = [];
      const filtered: FilteredStats = {
        toolCall: 0,
        toolResult: 0,
        sessionInfo: 0,
        malformed: 0,
        emptyText: 0,
      };
      let totalMatches = 0;
      let filesSearched = 0;

      for (const target of targets as ChannelLocator[]) {
        const meta = await readChannelMeta(config.sessionsDir, target.channelKey);
        const sessionFiles = await listSessionFiles(
          config.sessionsDir,
          target.channelKey,
          meta?.currentSessionId,
        );
        for (const sessionFile of sessionFiles) {
          if (input.sessionId && sessionFile.sessionId !== input.sessionId) continue;
          filesSearched += 1;
          const scan = await scanJsonlFile(
            join(config.sessionsDir, target.channelKey, sessionFile.filename),
            {
              messageTypes: new Set(input.messageTypes ?? ["user", "assistant"]),
              senderId,
              senderMatcher: input.senderQuery
                ? (candidate) =>
                    candidate?.toLowerCase().includes(input.senderQuery!.toLowerCase()) ?? false
                : undefined,
              contentMatcher: matcher ? (content) => matcher.test(content) : undefined,
              since: parseDate(input.since),
              until: parseDate(input.until),
            },
          );

          filtered.toolCall += scan.filtered.toolCall;
          filtered.toolResult += scan.filtered.toolResult;
          filtered.sessionInfo += scan.filtered.sessionInfo;
          filtered.malformed += scan.filtered.malformed;
          filtered.emptyText += scan.filtered.emptyText;

          for (const entry of scan.entries) {
            totalMatches += 1;
            if (results.length < limit) {
              results.push({
                ...entry,
                senderId: entry.senderId,
                platform: target.platform,
                channelId: target.channelId,
                channelKey: target.channelKey,
                sessionId: entry.sessionId ?? sessionFile.sessionId,
              });
            }
          }
        }
      }

      const sorted = [...results].sort((left, right) =>
        (input.sort ?? "desc") === "asc"
          ? left.timestamp.localeCompare(right.timestamp)
          : right.timestamp.localeCompare(left.timestamp),
      );

      return {
        scope,
        channelsSearched: scope === "global" ? (targets as ChannelLocator[]).length : 1,
        filesSearched,
        totalMatches,
        truncated: totalMatches > limit,
        filtered,
        results: sorted,
      };
    },
  };
}
