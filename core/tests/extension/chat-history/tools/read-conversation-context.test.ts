import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

// core/tests/extension/chat-history/tools/read-conversation-context.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createReadConversationContextTool } from "../../../../src/extension/chat-history/tools/read-conversation-context.js";
import type {
  ChannelLocator,
  ChatHistoryConfig,
} from "../../../../src/extension/chat-history/types.js";
import { createTempSessionsDir, setupTestChannel, FIXTURE_DIR } from "../fixtures/helpers.js";

describe("read_conversation_context tool", () => {
  let sessionsDir: string;
  let config: ChatHistoryConfig;
  let currentChannel: ChannelLocator;

  beforeEach(() => {
    sessionsDir = createTempSessionsDir();
    const fixtureContent = readFileSync(join(FIXTURE_DIR, "sample-session.jsonl"), "utf-8");
    setupTestChannel(sessionsDir, "onebot_group-123", {
      platform: "onebot",
      channelId: "group-123",
      jsonlFiles: { "sess-001.jsonl": fixtureContent },
      meta: {
        platform: "onebot",
        channel: "group-123",
        type: "group",
        current_session: "sess-001",
        updated_at: "2026-05-18T09:01:00Z",
      },
    });
    config = { sessionsDir, isolation: false, defaultLimit: 10, maxLimit: 30 };
    currentChannel = { platform: "onebot", channelId: "group-123", channelKey: "onebot_group-123" };
  });

  afterEach(() => {
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  it("returns context around a known message id", async () => {
    const tool = createReadConversationContextTool(config, currentChannel);
    const result = await tool.execute({ id: "msg-003" });
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.anchor_index).toBeGreaterThanOrEqual(0);
    expect(result.messages[result.anchor_index]).toContain(">>>");
  });

  it("respects before/after parameters", async () => {
    const tool = createReadConversationContextTool(config, currentChannel);
    const result = await tool.execute({ id: "msg-006", before: 2, after: 2 });
    expect(result.messages.length).toBeLessThanOrEqual(5);
    expect(result.anchor_index).toBeLessThanOrEqual(2);
  });

  it("returns first_id and last_id for traversal", async () => {
    const tool = createReadConversationContextTool(config, currentChannel);
    const result = await tool.execute({ id: "msg-006", before: 2, after: 2 });
    expect(result.first_id).toBeDefined();
    expect(result.last_id).toBeDefined();
    expect(result.first_id).not.toBe(result.last_id);
  });

  it("indicates has_more_before/after correctly", async () => {
    const tool = createReadConversationContextTool(config, currentChannel);
    const result = await tool.execute({ id: "msg-006", before: 1, after: 1 });
    expect(result.has_more_before).toBe(true);
    expect(result.has_more_after).toBe(true);
  });

  it("returns hint for unknown message id", async () => {
    const tool = createReadConversationContextTool(config, currentChannel);
    const result = await tool.execute({ id: "nonexistent-id" });
    expect(result.messages).toHaveLength(0);
    expect(result.hint).toBeDefined();
  });

  it("supports forward traversal (before=0)", async () => {
    const tool = createReadConversationContextTool(config, currentChannel);
    const result = await tool.execute({ id: "msg-001", before: 0, after: 5 });
    expect(result.anchor_index).toBe(0);
    expect(result.messages.length).toBeGreaterThan(1);
  });

  it("supports backward traversal (after=0)", async () => {
    const tool = createReadConversationContextTool(config, currentChannel);
    const result = await tool.execute({ id: "msg-010", before: 5, after: 0 });
    expect(result.anchor_index).toBe(result.messages.length - 1);
  });

  it("formats messages in compact line format", async () => {
    const tool = createReadConversationContextTool(config, currentChannel);
    const result = await tool.execute({ id: "msg-003", before: 1, after: 1 });
    for (const msg of result.messages) {
      expect(msg).toMatch(/^(>>> )?\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] (user .+|assistant): .+/);
    }
  });
});
