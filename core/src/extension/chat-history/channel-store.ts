// core/src/extension/chat-history/channel-store.ts
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { encodeChannelId } from "../../services/session/encoding.js";
import type { ChannelMapEntry } from "../../services/session/index.js";
import type {
  ChannelLocator,
  ChannelSummary,
  NormalizedChannelMeta,
  SessionFileInfo,
  ToolError,
} from "./types.js";

export function toolError(error: string, code: string, hint: string): ToolError {
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

export async function readChannelMap(
  sessionsDir: string,
): Promise<Record<string, ChannelMapEntry>> {
  try {
    const content = await readFile(join(sessionsDir, "channel-map.json"), "utf-8");
    return JSON.parse(content) as Record<string, ChannelMapEntry>;
  } catch {
    return {};
  }
}

export async function resolveChannelLocator(input: {
  sessionsDir: string;
  isolation: boolean;
  currentChannel: ChannelLocator | null;
  platform?: string;
  channelId?: string;
  channelKey?: string;
}): Promise<ChannelLocator | ToolError> {
  const { currentChannel } = input;
  const requestedKey =
    input.platform && input.channelId
      ? encodeChannelId(input.platform, input.channelId)
      : input.channelKey;

  if (input.isolation) {
    if (!currentChannel) {
      return toolError(
        "当前频道上下文不可用。",
        "CURRENT_CHANNEL_REQUIRED",
        "请在频道绑定的会话中重试。",
      );
    }
    if (requestedKey && requestedKey !== currentChannel.channelKey) {
      return toolError(
        "隔离模式下只能访问当前频道。",
        "ISOLATION_VIOLATION",
        "请搜索当前频道，或联系管理员开启共享模式。",
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
        `未找到频道: ${input.channelKey}`,
        "CHANNEL_NOT_FOUND",
        "请检查频道标识是否正确。",
      );
    }
    return {
      platform: entry.platform,
      channelId: entry.channelId,
      channelKey: input.channelKey,
    };
  }

  if (currentChannel) return currentChannel;

  return toolError(
    "无法确定目标频道。",
    "CHANNEL_REQUIRED",
    "请提供频道信息或在频道绑定的会话中使用。",
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

  // 扫描 sessions 目录下的所有子目录，确保不遗漏任何频道
  let entries: string[];
  try {
    entries = await readdir(sessionsDir);
  } catch {
    return [];
  }

  // 将所有子目录视为潜在的频道目录
  const channelDirs = entries.filter((e) => !e.includes(".") && e !== "channel-map.json");

  // 合并 channel-map 中的条目和实际存在的目录
  const allChannelKeys = new Set<string>();
  for (const key of Object.keys(map)) {
    allChannelKeys.add(key);
  }
  for (const dir of channelDirs) {
    allChannelKeys.add(dir);
  }

  const summaries: ChannelSummary[] = [];

  for (const channelKey of allChannelKeys) {
    const entry = map[channelKey];
    const meta = await readChannelMeta(sessionsDir, channelKey);

    // 如果 channel-map 中有条目，使用它；否则尝试从 meta.json 中读取
    // channel-map.json 可能使用 'channel' 或 'channelId' 字段名（兼容两种格式）
    const platform = entry?.platform ?? meta?.platform;
    const channelId = entry?.channelId ?? meta?.channelId;

    if (!platform || !channelId) {
      // 无法确定平台和频道ID，跳过
      continue;
    }

    // 从 meta.json 获取类型，如果没有则从 channelId 推断
    const type = meta?.type ?? (channelId.startsWith("private") ? "private" : undefined);

    summaries.push({
      channelKey,
      platform,
      channelId,
      type,
      currentSessionId: meta?.currentSessionId,
      sessionCount: meta?.sessionCount,
      lastActiveAt: meta?.updatedAt ?? meta?.lastActiveAt,
    });
  }

  return summaries;
}

export async function listSessionFiles(
  sessionsDir: string,
  channelKey: string,
  currentSessionId?: string,
): Promise<SessionFileInfo[]> {
  const dir = join(sessionsDir, channelKey);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const jsonlFiles = entries.filter((e) => e.endsWith(".jsonl")).sort();

  return Promise.all(
    jsonlFiles.map(async (filename) => {
      const fullPath = join(dir, filename);
      const stats = await stat(fullPath);
      const sessionId = filename.replace(/\.jsonl$/, "");
      return {
        sessionId,
        filename,
        fullPath,
        size: stats.size,
        modified: stats.mtime,
        isCurrent: sessionId === currentSessionId,
      };
    }),
  );
}
