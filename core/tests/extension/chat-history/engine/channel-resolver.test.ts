import { rmSync } from "node:fs";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { ChannelResolver } from "../../../../src/extension/built-in/chat-history/engine/channel-resolver.js";
import { createTempSessionsDir, setupTestChannel, makeSearchContext } from "../fixtures/helpers.js";

describe("ChannelResolver", () => {
  let sessionsDir: string;

  beforeEach(() => {
    sessionsDir = createTempSessionsDir();
    setupTestChannel(sessionsDir, "onebot_group-123", {
      platform: "onebot",
      channelId: "group-123",
      meta: {
        platform: "onebot",
        channel: "group-123",
        type: "group",
        updated_at: "2026-05-18T09:00:00Z",
      },
    });
    setupTestChannel(sessionsDir, "onebot_group-456", {
      platform: "onebot",
      channelId: "group-456",
      meta: {
        platform: "onebot",
        channel: "group-456",
        type: "group",
        updated_at: "2026-05-17T09:00:00Z",
      },
    });
  });

  afterEach(() => {
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  it("returns current channel for where=here", async () => {
    const ctx = makeSearchContext(sessionsDir);
    const resolver = new ChannelResolver(ctx);
    const channels = await resolver.resolve("here");
    expect(channels).toHaveLength(1);
    expect(channels[0].channelKey).toBe("onebot_group-123");
  });

  it("returns error for where=here when no current channel", async () => {
    const ctx = makeSearchContext(sessionsDir, { currentChannel: null });
    const resolver = new ChannelResolver(ctx);
    const result = await resolver.resolve("here");
    expect(result).toHaveProperty("error");
    expect(result).toHaveProperty("code", "CURRENT_CHANNEL_REQUIRED");
  });

  it("returns multiple channels for where=all in shared mode", async () => {
    const ctx = makeSearchContext(sessionsDir, { isolation: false });
    const resolver = new ChannelResolver(ctx);
    const channels = await resolver.resolve("all");
    expect(channels.length).toBeGreaterThan(1);
  });

  it("rejects where=all in isolation mode", async () => {
    const ctx = makeSearchContext(sessionsDir, { isolation: true });
    const resolver = new ChannelResolver(ctx);
    const result = await resolver.resolve("all");
    expect(result).toHaveProperty("error");
    expect(result).toHaveProperty("code", "ISOLATION_VIOLATION");
  });

  it("sorts channels by lastActiveAt descending", async () => {
    const ctx = makeSearchContext(sessionsDir);
    const resolver = new ChannelResolver(ctx);
    const result = await resolver.resolve("all");
    expect(Array.isArray(result)).toBe(true);
    const channels = result as NonNullable<typeof result>;
    expect(channels.length).toBeGreaterThanOrEqual(2);
    expect(channels[0].lastActiveAt! >= channels[1].lastActiveAt!).toBe(true);
  });

  it("limits to maxChannels", async () => {
    const ctx = makeSearchContext(sessionsDir);
    const resolver = new ChannelResolver(ctx);
    const result = await resolver.resolve("all", { maxChannels: 1 });
    expect(Array.isArray(result)).toBe(true);
    const channels = result as NonNullable<typeof result>;
    expect(channels.length).toBeLessThanOrEqual(1);
  });

  it("uses default maxChannels of 10", async () => {
    const ctx = makeSearchContext(sessionsDir);
    const resolver = new ChannelResolver(ctx);
    const result = await resolver.resolve("all");
    expect(Array.isArray(result)).toBe(true);
    const channels = result as NonNullable<typeof result>;
    expect(channels.length).toBeLessThanOrEqual(10);
  });
});
