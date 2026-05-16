import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFindChannelsTool, createListSessionsTool } from "../src/tools";
import type { SessionContextConfig } from "../src/types";
import { channelKeyFor, writeChannelFixture, writeJson, writeJsonl } from "./helpers";

function makeConfig(tempDir: string, isolation = false): SessionContextConfig {
  return { sessionsDir: tempDir, isolation, defaultLimit: 20, maxLimit: 100 };
}

describe("find-channels and list-sessions", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "session-context-discovery-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns limited recent channel summaries in shared mode", async () => {
    const keyA = channelKeyFor("onebot", "10001");
    const keyB = channelKeyFor("discord", "guild-2");
    await writeJson(tempDir, "channel-map.json", {
      [keyA]: { platform: "onebot", channel: "10001" },
      [keyB]: { platform: "discord", channel: "guild-2" },
    });
    await writeJson(tempDir, `${keyA}/meta.json`, {
      platform: "onebot",
      channel: "10001",
      current_session: "current-a.jsonl",
      last_message: "2026-05-15T10:00:00.000Z",
      session_count: 2,
    });
    await writeJson(tempDir, `${keyB}/meta.json`, {
      platform: "discord",
      channel: "guild-2",
      current_session: "current-b.jsonl",
      last_message: "2026-05-15T11:00:00.000Z",
      session_count: 1,
    });
    await writeJsonl(tempDir, `${keyA}/current-a.jsonl`, []);
    await writeJsonl(tempDir, `${keyB}/current-b.jsonl`, []);

    const tool = createFindChannelsTool(makeConfig(tempDir), null);
    const result = await tool.execute({ limit: 1, sortBy: "recent" });

    expect(result).toMatchObject({ truncated: true });
    expect((result as { channels: Array<{ channelId: string }> }).channels[0].channelId).toBe(
      "guild-2",
    );
  });

  it("lists sessions only after channel locator is resolved", async () => {
    const channelKey = await writeChannelFixture(tempDir, "onebot", "10001", {
      platform: "onebot",
      channel: "10001",
      current_session: "current-a.jsonl",
      session_count: 2,
    });
    await writeJsonl(tempDir, `${channelKey}/current-a.jsonl`, []);
    await writeJsonl(tempDir, `${channelKey}/older.jsonl`, []);

    const tool = createListSessionsTool(makeConfig(tempDir), null);
    const result = await tool.execute({ platform: "onebot", channelId: "10001" });

    expect(result).toMatchObject({
      channel: { channelKey, channelId: "10001" },
    });
    expect(
      (result as { sessions: Array<{ sessionId: string; isCurrent: boolean }> }).sessions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: "current-a", isCurrent: true }),
        expect.objectContaining({ sessionId: "older", isCurrent: false }),
      ]),
    );
  });

  it("rejects empty list_sessions locator in shared mode", async () => {
    const tool = createListSessionsTool(makeConfig(tempDir), null);
    const result = await tool.execute({});
    expect(result).toMatchObject({ code: "CHANNEL_REQUIRED" });
  });

  it("exports new discovery tool names through barrel", () => {
    expect(createFindChannelsTool(makeConfig(tempDir), null).name).toBe("find_channels");
    expect(createListSessionsTool(makeConfig(tempDir), null).name).toBe("list_sessions");
  });

  it("rejects non-current discovery in isolation mode", async () => {
    const currentChannel = {
      platform: "onebot",
      channelId: "10001",
      channelKey: channelKeyFor("onebot", "10001"),
    };
    const tool = createFindChannelsTool(makeConfig(tempDir, true), currentChannel);
    const result = await tool.execute({ platform: "onebot", channelId: "20002" });
    expect(result).toMatchObject({ code: "ISOLATION_VIOLATION" });
  });
});
