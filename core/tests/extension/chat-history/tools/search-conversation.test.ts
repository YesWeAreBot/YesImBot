import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

// core/tests/extension/chat-history/tools/search-conversation.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createSearchConversationTool } from "../../../../src/services/extension/built-in/chat-history/tools/search-conversation.js";
import type {
  ChannelLocator,
  ChatHistoryConfig,
} from "../../../../src/services/extension/built-in/chat-history/types.js";
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

  it("supports time-range search without query", async () => {
    const tool = createSearchConversationTool(config, currentChannel);
    // 执行无 query 的时间范围搜索（使用足够宽的时间范围包含文件修改时间）
    const result = await tool.execute({
      since: "2026-05-17T00:00:00Z",
      until: "2026-05-20T00:00:00Z",
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.total_found).toBeGreaterThan(0);
  });

  it("filters by user ID and name", async () => {
    const tool = createSearchConversationTool(config, currentChannel);

    // 按昵称过滤
    const resultByName = await tool.execute({
      query: "讨论",
      user: "Alice",
    });

    // 按 ID 过滤（actor ID）
    const resultById = await tool.execute({
      query: "讨论",
      user: "user-alice",
    });

    expect(resultByName.results.length).toBeGreaterThan(0);
    expect(resultByName.results.every((r) => r.speaker === "Alice")).toBe(true);

    expect(resultById.results.length).toBeGreaterThan(0);
    expect(resultById.results.every((r) => r.speaker === "Alice")).toBe(true);
  });

  it("searches for numeric ID in message content", async () => {
    // 创建包含数字 ID 的测试数据
    const testContent = `{"type":"session","id":"test-sess","timestamp":"2026-05-19T09:00:00.000Z","cwd":"/tmp"}
{"type":"custom_message","id":"msg-1","timestamp":"2026-05-19T09:01:00.000Z","customType":"athena:event","content":"用户ID是1293865264","display":true,"details":{"version":1,"id":"evt-1","kind":"chat_message","timestamp":1779181260000,"source":{"platform":"test","channelId":"ch-1","conversationType":"private"},"actor":{"id":"user-1","name":"Alice"},"payload":{"messageId":"m-1","content":"用户ID是1293865264"}}}`;

    const testSessionsDir = createTempSessionsDir();
    setupTestChannel(testSessionsDir, "test_ch-1", {
      platform: "test",
      channelId: "ch-1",
      jsonlFiles: { "test-sess.jsonl": testContent },
      meta: { platform: "test", channel: "ch-1", type: "private", current_session: "test-sess" },
    });

    const testConfig = { ...config, sessionsDir: testSessionsDir };
    const testChannel = { platform: "test", channelId: "ch-1", channelKey: "test_ch-1" };
    const tool = createSearchConversationTool(testConfig, testChannel);

    const result = await tool.execute({ query: "1293865264" });

    expect(result.results.length).toBe(1);
    expect(result.results[0].snippet).toContain("1293865264");

    rmSync(testSessionsDir, { recursive: true, force: true });
  });
});
