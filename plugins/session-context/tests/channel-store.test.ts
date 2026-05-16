import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalizeChannelMeta, resolveChannelLocator } from "../src/channel-store";
import { channelKeyFor, writeChannelFixture } from "./helpers";

describe("channel-store", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "session-context-locator-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("builds locator from platform and channelId", async () => {
    const result = await resolveChannelLocator({
      sessionsDir: tempDir,
      isolation: false,
      currentChannel: null,
      platform: "onebot",
      channelId: "123456",
    });

    expect(result).toEqual({
      platform: "onebot",
      channelId: "123456",
      channelKey: channelKeyFor("onebot", "123456"),
    });
  });

  it("resolves channelKey through channel-map.json", async () => {
    const channelKey = await writeChannelFixture(tempDir, "discord", "guild-42", {
      platform: "discord",
      channel: "guild-42",
      current_session: "current.jsonl",
      session_count: 1,
    });

    const result = await resolveChannelLocator({
      sessionsDir: tempDir,
      isolation: false,
      currentChannel: null,
      channelKey,
    });

    expect(result).toEqual({
      platform: "discord",
      channelId: "guild-42",
      channelKey,
    });
  });

  it("normalizes both snake_case and camelCase meta fields", () => {
    expect(
      normalizeChannelMeta({
        platform: "onebot",
        channel: "10001",
        current_session: "a.jsonl",
        last_message: "2026-05-15T12:00:00.000Z",
        session_count: 2,
      }),
    ).toEqual({
      platform: "onebot",
      channelId: "10001",
      currentSessionId: "a",
      lastActiveAt: "2026-05-15T12:00:00.000Z",
      sessionCount: 2,
    });

    expect(
      normalizeChannelMeta({
        platform: "onebot",
        channel: "10001",
        currentSession: "b.jsonl",
        lastMessage: "2026-05-15T13:00:00.000Z",
        sessionCount: 3,
      }),
    ).toEqual({
      platform: "onebot",
      channelId: "10001",
      currentSessionId: "b",
      lastActiveAt: "2026-05-15T13:00:00.000Z",
      sessionCount: 3,
    });
  });

  it("rejects cross-channel locator in isolation mode", async () => {
    const result = await resolveChannelLocator({
      sessionsDir: tempDir,
      isolation: true,
      currentChannel: {
        platform: "onebot",
        channelId: "123456",
        channelKey: channelKeyFor("onebot", "123456"),
      },
      platform: "onebot",
      channelId: "999999",
    });

    expect(result).toMatchObject({
      code: "ISOLATION_VIOLATION",
    });
  });
});
