import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import type { ChannelMapEntry, ChannelMeta } from "./types.js";

export function readMeta(channelDir: string): ChannelMeta | null {
  const metaPath = join(channelDir, "meta.json");
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8")) as ChannelMeta;
  } catch {
    return null;
  }
}

export function writeMeta(channelDir: string, meta: ChannelMeta): void {
  const metaPath = join(channelDir, "meta.json");
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

export function createMeta(
  platform: string,
  channel: string,
  type: "private" | "group",
  sessionFile: string,
  sessionCount: number,
  assignee?: string,
): ChannelMeta {
  const now = new Date().toISOString();
  return {
    platform,
    channel,
    type,
    current_session: basename(sessionFile),
    last_message: now,
    updated_at: now,
    session_count: sessionCount,
    ...(assignee ? { assignee } : {}),
  };
}

export function readChannelMap(mapPath: string): Record<string, ChannelMapEntry> {
  if (!existsSync(mapPath)) return {};
  try {
    return JSON.parse(readFileSync(mapPath, "utf-8")) as Record<string, ChannelMapEntry>;
  } catch {
    return {};
  }
}

export function writeChannelMap(mapPath: string, map: Record<string, ChannelMapEntry>): void {
  const sessionsDir = dirname(mapPath);
  if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(mapPath, JSON.stringify(map, null, 2));
}
