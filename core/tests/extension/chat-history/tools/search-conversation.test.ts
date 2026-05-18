import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

// core/tests/extension/chat-history/tools/search-conversation.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createSearchConversationTool } from "../../../../src/extension/chat-history/tools/search-conversation.js";
import type {
  ChannelLocator,
  ChatHistoryConfig,
} from "../../../../src/extension/chat-history/types.js";
import { createTempSessionsDir, setupTestChannel, FIXTURE_DIR } from "../fixtures/helpers.js";

describe("search_conversation tool", () => {
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

  it("searches current channel by keyword", async () => {
    const tool = createSearchConversationTool(config, currentChannel);
    const result = await tool.execute({ query: "Docker", where: "here" });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((r) => r.snippet.toLowerCase().includes("docker"))).toBe(true);
  });

  it("returns hint for empty results", async () => {
    const tool = createSearchConversationTool(config, currentChannel);
    const result = await tool.execute({ query: "不存在的关键词xyz", where: "here" });
    expect(result.results).toHaveLength(0);
    expect(result.hint).toBeDefined();
  });

  it("rejects single-char query", async () => {
    const tool = createSearchConversationTool(config, currentChannel);
    const result = await tool.execute({ query: "a", where: "here" });
    expect(result.results).toHaveLength(0);
    expect(result.hint).toContain("具体");
  });

  it("filters by user", async () => {
    const tool = createSearchConversationTool(config, currentChannel);
    const result = await tool.execute({ query: "讨论", where: "here", user: "Alice" });
    expect(result.results.every((r) => r.speaker === "Alice")).toBe(true);
  });

  it("filters by role", async () => {
    const tool = createSearchConversationTool(config, currentChannel);
    const result = await tool.execute({ query: "测试", where: "here", role: "assistant" });
    expect(result.results.every((r) => r.speaker === "assistant")).toBe(true);
  });

  it("rejects cross-channel without filters in isolation mode", async () => {
    const isolatedConfig = { ...config, isolation: true };
    const tool = createSearchConversationTool(isolatedConfig, currentChannel);
    const result = await tool.execute({ query: "test", where: "all" });
    expect(result.hint).toContain("隔离");
  });

  it("includes message IDs usable by read_conversation_context", async () => {
    const tool = createSearchConversationTool(config, currentChannel);
    const result = await tool.execute({ query: "项目进度", where: "here" });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].id).toMatch(/^msg-/);
  });
});
