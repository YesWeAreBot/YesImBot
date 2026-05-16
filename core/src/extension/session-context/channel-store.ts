import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { encodeChannelId } from "../../services/session/encoding.js";
import type {
  ChannelLocator,
  ChannelSummary,
  NormalizedChannelMeta,
  ResolveChannelLocatorInput,
  ToolError,
} from "./types.js";

interface ChannelMapEntry {
  platform: string;
  channel: string;
}

function toolError(error: string, code: string, hint: string): ToolError {
  return { error, code, hint };
}

export function normalizeChannelMeta(raw: unknown): NormalizedChannelMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const meta = raw as Record<string, unknown>;
  const currentSession = meta.current_session ?? meta.currentSession;
  const lastActiveAt = meta.last_message ?? meta.lastMessage;
  const updatedAt = meta.updated_at ?? meta.updatedAt;
  const sessionCount = meta.session_count ?? meta.sessionCount;

  return {
    platform: typeof meta.platform === "string" ? meta.platform : undefined,
    channelId: typeof meta.channel === "string" ? meta.channel : undefined,
    type: meta.type === "group" || meta.type === "private" ? meta.type : undefined,
    currentSessionId:
      typeof currentSession === "string" ? currentSession.replace(/\.jsonl$/, "") : undefined,
    lastActiveAt: typeof lastActiveAt === "string" ? lastActiveAt : undefined,
    updatedAt: typeof updatedAt === "string" ? updatedAt : undefined,
    sessionCount: typeof sessionCount === "number" ? sessionCount : undefined,
  };
}

async function readChannelMap(sessionsDir: string): Promise<Record<string, ChannelMapEntry>> {
  try {
    const content = await readFile(join(sessionsDir, "channel-map.json"), "utf-8");
    return JSON.parse(content) as Record<string, ChannelMapEntry>;
  } catch {
    return {};
  }
}

export async function resolveChannelLocator(
  input: ResolveChannelLocatorInput,
): Promise<ChannelLocator | ToolError> {
  const currentChannel = input.currentChannel;
  const requestedKey =
    input.platform && input.channelId
      ? encodeChannelId(input.platform, input.channelId)
      : input.channelKey;

  if (input.isolation) {
    if (!currentChannel) {
      return toolError(
        "Current channel context is required in isolation mode.",
        "CURRENT_CHANNEL_REQUIRED",
        "Retry from a channel-bound session.",
      );
    }

    if (requestedKey && requestedKey !== currentChannel.channelKey) {
      return toolError(
        "Isolation mode only allows current channel.",
        "ISOLATION_VIOLATION",
        "Search current channel or disable isolation mode.",
      );
    }

    return currentChannel;
  }

  if (input.platform && input.channelId) {
    return {
      platform: input.platform,
      channelId: input.channelId,
      channelKey: encodeChannelId(input.platform, input.channelId),
    };
  }

  if (input.channelKey) {
    const map = await readChannelMap(input.sessionsDir);
    const entry = map[input.channelKey];
    if (!entry) {
      return toolError(
        `Unknown channelKey: ${input.channelKey}`,
        "CHANNEL_NOT_FOUND",
        "Use find_channels or provide platform + channelId.",
      );
    }

    return {
      platform: entry.platform,
      channelId: entry.channel,
      channelKey: input.channelKey,
    };
  }

  if (input.current && currentChannel) {
    return currentChannel;
  }

  return toolError(
    "Channel locator required.",
    "CHANNEL_REQUIRED",
    "Provide platform + channelId, channelKey, or current=true.",
  );
}

export async function readChannelMeta(
  sessionsDir: string,
  channelKey: string,
): Promise<NormalizedChannelMeta | null> {
  try {
    const content = await readFile(join(sessionsDir, channelKey, "meta.json"), "utf-8");
    return normalizeChannelMeta(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function listChannelSummaries(sessionsDir: string): Promise<ChannelSummary[]> {
  const map = await readChannelMap(sessionsDir);
  const summaries = await Promise.all(
    Object.entries(map).map(async ([channelKey, entry]) => {
      const meta = await readChannelMeta(sessionsDir, channelKey);
      return {
        channelKey,
        platform: entry.platform,
        channelId: entry.channel,
        type: meta?.type,
        currentSessionId: meta?.currentSessionId,
        sessionCount: meta?.sessionCount,
        lastActiveAt: meta?.updatedAt ?? meta?.lastActiveAt,
        matchReason: "channel-map",
      } satisfies ChannelSummary;
    }),
  );

  return summaries;
}

export async function listSessionFiles(
  sessionsDir: string,
  channelKey: string,
  currentSessionId?: string,
) {
  const dir = join(sessionsDir, channelKey);
  const entries = await readdir(dir);
  const jsonlFiles = entries.filter((entry) => entry.endsWith(".jsonl")).sort();

  return Promise.all(
    jsonlFiles.map(async (filename) => {
      const fullPath = join(dir, filename);
      const stats = await stat(fullPath);
      const sessionId = filename.replace(/\.jsonl$/, "");
      return {
        sessionId,
        filename,
        size: stats.size,
        modified: stats.mtime.toISOString(),
        isCurrent: sessionId === currentSessionId,
      };
    }),
  );
}
