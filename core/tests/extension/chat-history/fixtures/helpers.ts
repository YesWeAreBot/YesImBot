import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
// core/tests/extension/chat-history/fixtures/helpers.ts
import { join } from "node:path";

import type {
  ChannelLocator,
  SearchContext,
} from "../../../../src/extension/chat-history/types.js";

export const FIXTURE_DIR = join(import.meta.dirname, ".");

export function createTempSessionsDir(): string {
  const dir = join(tmpdir(), `chat-history-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function setupTestChannel(
  sessionsDir: string,
  channelKey: string,
  options: {
    platform: string;
    channelId: string;
    jsonlFiles?: Record<string, string>;
    meta?: Record<string, unknown>;
  },
): void {
  const channelDir = join(sessionsDir, channelKey);
  mkdirSync(channelDir, { recursive: true });

  // Write channel-map.json
  const mapPath = join(sessionsDir, "channel-map.json");
  let map: Record<string, { platform: string; channel?: string; channelId?: string }> = {};
  if (existsSync(mapPath)) {
    map = JSON.parse(readFileSync(mapPath, "utf-8"));
  }
  map[channelKey] = { platform: options.platform, channel: options.channelId };
  writeFileSync(mapPath, JSON.stringify(map, null, 2));

  // Write meta.json
  if (options.meta) {
    writeFileSync(join(channelDir, "meta.json"), JSON.stringify(options.meta));
  }

  // Write JSONL files
  if (options.jsonlFiles) {
    for (const [filename, content] of Object.entries(options.jsonlFiles)) {
      writeFileSync(join(channelDir, filename), content);
    }
  }
}

export function makeSearchContext(
  sessionsDir: string,
  overrides?: Partial<SearchContext>,
): SearchContext {
  return {
    sessionsDir,
    isolation: false,
    currentChannel: {
      platform: "onebot",
      channelId: "group-123",
      channelKey: "onebot_group-123",
    },
    defaultLimit: 10,
    maxLimit: 30,
    ...overrides,
  };
}
