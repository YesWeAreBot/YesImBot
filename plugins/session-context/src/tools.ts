import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { ToolDefinition } from "@yesimbot/agent/session";
import { z } from "zod/v4";

import { streamJsonl } from "./jsonl-parser.js";
import type {
  ChannelInfo,
  ListSessionsResult,
  SearchResults,
  SessionContextConfig,
  SessionFileInfo,
} from "./types.js";

// ============================================================================
// Helpers
// ============================================================================

function parseDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? undefined : ts;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function listJsonlFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries
      .filter((e) => e.endsWith(".jsonl"))
      .sort()
      .map((e) => join(dir, e));
  } catch {
    return [];
  }
}

// ============================================================================
// search_session
// ============================================================================

const SEARCH_DESCRIPTION = `Search historical session messages by keyword and filters.

Returns matching user and assistant messages from session JSONL files.
Tool-call and tool-result messages are automatically filtered out.
Content is truncated to 500 characters per message.

Filters:
- keyword: regex pattern matched case-insensitively against message content
- channelKey: target channel (format: "platform:channelId"), defaults to current channel
- user: filter by sender ID (user messages only)
- messageTypes: restrict to specific types ("user", "assistant", "session")
- since / until: ISO 8601 timestamp boundaries
- sessionId: restrict to a specific session file
- limit: max results (capped by server config)`;

export function createSearchSessionTool(
  config: SessionContextConfig,
  currentChannelKey: string,
): ToolDefinition {
  return {
    name: "search_session",
    description: SEARCH_DESCRIPTION,
    promptSnippet: "Search historical session messages",
    inputSchema: z.object({
      keyword: z
        .string()
        .optional()
        .describe("Regex pattern to search message content (case-insensitive)"),
      channelKey: z
        .string()
        .optional()
        .describe('Target channel key, e.g. "onebot:123456". Defaults to current channel'),
      user: z.string().optional().describe("Filter by sender ID (user messages only)"),
      messageTypes: z
        .array(z.string())
        .optional()
        .describe('Message types to include: "user", "assistant", "session"'),
      since: z.string().optional().describe("ISO 8601 timestamp — only messages after this time"),
      until: z.string().optional().describe("ISO 8601 timestamp — only messages before this time"),
      sessionId: z
        .string()
        .optional()
        .describe("Restrict search to a specific session file (without .jsonl extension)"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          `Max results to return (default: ${config.defaultLimit}, max: ${config.maxLimit})`,
        ),
    }),
    execute: async (input) => {
      const {
        keyword,
        channelKey: rawChannelKey,
        user,
        messageTypes,
        since: sinceStr,
        until: untilStr,
        sessionId,
        limit: rawLimit,
      } = input as {
        keyword?: string;
        channelKey?: string;
        user?: string;
        messageTypes?: string[];
        since?: string;
        until?: string;
        sessionId?: string;
        limit?: number;
      };

      // Resolve channel key
      const channelKey = config.isolation
        ? currentChannelKey
        : (rawChannelKey ?? currentChannelKey);

      // Parse keyword regex
      let keywordRegex: RegExp | undefined;
      if (keyword) {
        try {
          keywordRegex = new RegExp(keyword, "i");
        } catch {
          return { error: `Invalid regex pattern: ${keyword}` };
        }
      }

      // Parse dates
      const since = parseDate(sinceStr);
      const until = parseDate(untilStr);

      // Resolve limit
      const limit = Math.min(rawLimit ?? config.defaultLimit, config.maxLimit);

      // Resolve message type filter
      const typeFilter = messageTypes?.length ? new Set(messageTypes) : undefined;

      // Build file list
      const channelDir = join(config.sessionsDir, channelKey);
      let files: string[];

      if (sessionId) {
        const filePath = join(channelDir, `${sessionId}.jsonl`);
        if (!(await fileExists(filePath))) {
          return { error: `Session file not found: ${sessionId}.jsonl` };
        }
        files = [filePath];
      } else {
        files = await listJsonlFiles(channelDir);
        if (files.length === 0) {
          return { error: `No session files found for channel: ${channelKey}` };
        }
      }

      // Search
      const results: SearchResults["results"] = [];
      let filtered = { toolCalls: 0, toolResults: 0 };
      let totalMatches = 0;
      let truncated = false;

      for (const file of files) {
        if (results.length >= limit) break;

        const stream = streamJsonl(file, {
          keyword: keywordRegex,
          messageTypes: typeFilter,
          user,
          since,
          until,
        });

        for await (const entry of stream) {
          totalMatches++;
          if (results.length < limit) {
            results.push(entry);
          } else {
            truncated = true;
          }
        }
      }

      return {
        results,
        totalMatches,
        truncated,
        channelKey,
        filesSearched: files.length,
        filtered,
      } satisfies SearchResults;
    },
  };
}

// ============================================================================
// list_sessions
// ============================================================================

const LIST_DESCRIPTION = `List available channels and their session files.

Without channelKey: returns all channels from channel-map.json.
With channelKey: returns session files for that specific channel.`;

export function createListSessionsTool(
  config: SessionContextConfig,
  currentChannelKey: string,
): ToolDefinition {
  return {
    name: "list_sessions",
    description: LIST_DESCRIPTION,
    promptSnippet: "List channels and session files",
    inputSchema: z.object({
      channelKey: z
        .string()
        .optional()
        .describe('Channel key to list sessions for, e.g. "onebot:123456"'),
    }),
    execute: async (input) => {
      const { channelKey: rawChannelKey } = input as { channelKey?: string };

      const channelKey = config.isolation ? currentChannelKey : (rawChannelKey ?? undefined);

      // List a specific channel's sessions
      if (channelKey) {
        const channelDir = join(config.sessionsDir, channelKey);
        const metaPath = join(channelDir, "meta.json");

        if (!(await fileExists(channelDir))) {
          return { error: `Channel directory not found: ${channelKey}` };
        }

        const meta = await readJsonFile<{ currentSession?: string }>(metaPath);
        const files = await listJsonlFiles(channelDir);

        const sessions: SessionFileInfo[] = await Promise.all(
          files.map(async (f) => {
            const s = await stat(f);
            return {
              filename: f.split("/").pop()!,
              size: s.size,
              modified: s.mtime.toISOString(),
            };
          }),
        );

        return {
          channelKey,
          sessions,
          currentSession: meta?.currentSession,
        } satisfies ListSessionsResult;
      }

      // List all channels
      const mapPath = join(config.sessionsDir, "channel-map.json");
      const channelMap = await readJsonFile<Record<string, string>>(mapPath);

      if (!channelMap) {
        return { error: "channel-map.json not found or invalid" };
      }

      const channels: ChannelInfo[] = [];

      for (const [key, channelType] of Object.entries(channelMap)) {
        const channelDir = join(config.sessionsDir, key);
        const metaPath = join(channelDir, "meta.json");
        const meta = await readJsonFile<{
          currentSession?: string;
          lastMessage?: string;
        }>(metaPath);

        const files = await listJsonlFiles(channelDir);
        const [platform, channel] = key.split(":", 2);

        channels.push({
          channelKey: key,
          platform,
          channel,
          type: channelType,
          currentSession: meta?.currentSession ?? "",
          sessionCount: files.length,
          lastMessage: meta?.lastMessage ?? "",
        });
      }

      return { channels } satisfies ListSessionsResult;
    },
  };
}
