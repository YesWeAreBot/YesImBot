import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

// core/tests/extension/chat-history/tools/search-user-activity.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createSearchUserActivityTool } from "../../../../src/extension/chat-history/tools/search-user-activity.js";
import type {
  ChannelLocator,
  ChatHistoryConfig,
} from "../../../../src/extension/chat-history/types.js";
import { createTempSessionsDir, setupTestChannel, FIXTURE_DIR } from "../fixtures/helpers.js";

describe("search_user_activity tool", () => {
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
    setupTestChannel(sessionsDir, "onebot_group-456", {
      platform: "onebot",
      channelId: "group-456",
      jsonlFiles: {
        "sess-002.jsonl":
          JSON.stringify({
            type: "session",
            id: "sess-002",
            timestamp: "2026-05-17T12:00:00Z",
            cwd: "/workspace",
          }) +
          "\n" +
          JSON.stringify({
            type: "custom_message",
            id: "msg-100",
            customType: "athena:event",
            content: [{ type: "text", text: "Alice 在另一个频道说话" }],
            details: {
              version: 1,
              id: "msg-100",
              kind: "chat_message",
              timestamp: 1779026460000,
              source: { platform: "onebot", channelId: "group-456", conversationType: "group" },
              actor: { id: "user-alice", name: "Alice" },
              payload: { messageId: "msg-100", content: "Alice 在另一个频道说话" },
            },
          }) +
          "\n",
      },
      meta: {
        platform: "onebot",
        channel: "group-456",
        type: "group",
        current_session: "sess-002",
        updated_at: "2026-05-17T12:01:00Z",
      },
    });
    config = { sessionsDir, isolation: false, defaultLimit: 10, maxLimit: 30 };
    currentChannel = {
      platform: "onebot",
      channelId: "group-123",
      channelKey: "onebot_group-123",
    };
  });

  afterEach(() => {
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  it("returns text format with channel headers", async () => {
    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "Alice" });
    expect(result.text).toBeDefined();
    expect(result.text).toContain("## onebot:group-123 (group)");
  });

  it("marks hit messages with >>>", async () => {
    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "Alice" });
    expect(result.text).toContain(">>>");
  });

  it("includes context messages without >>>", async () => {
    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "Alice" });
    // Bob 的消息应该是上下文，没有 >>> 标记
    expect(result.text).toContain("Bob");
    // 检查 Bob 的消息行不以 >>> 开头
    const lines = result.text.split("\n");
    const bobLines = lines.filter((l) => l.includes("Bob:") && !l.includes(">>>"));
    expect(bobLines.length).toBeGreaterThan(0);
  });

  it("groups messages by time window", async () => {
    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "Alice" });
    // 应该有时间分组标题
    expect(result.text).toMatch(/### \d{4}-\d{2}-\d{2}/);
  });

  it("returns hint when user not found", async () => {
    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "不存在的用户xyz" });
    expect(result.text).toBe("");
    expect(result.hint).toBeDefined();
  });

  it("respects isolation mode", async () => {
    const isolatedConfig = { ...config, isolation: true };
    const tool = createSearchUserActivityTool(isolatedConfig, currentChannel);
    const result = await tool.execute({ user: "Alice" });
    expect(result.text).toContain("group-123");
    expect(result.text).not.toContain("group-456");
  });

  it("filters by content query", async () => {
    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "Alice", query: "项目进度" });
    expect(result.text).toContain(">>>");
    expect(result.text).toContain("项目进度");
  });

  it("works without query (user-only search)", async () => {
    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "Alice" });
    expect(result.text).toContain(">>>");
  });

  it("filters by time range (since/until)", async () => {
    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({
      user: "Alice",
      since: "2026-01-01T00:00:00Z",
      until: "2026-12-31T23:59:59Z",
    });
    expect(result.text).toContain(">>>");
  });

  it("distinguishes private chat channels", async () => {
    // 添加私聊频道
    setupTestChannel(sessionsDir, "onebot_private-789", {
      platform: "onebot",
      channelId: "private-789",
      jsonlFiles: {
        "sess-003.jsonl":
          JSON.stringify({
            type: "session",
            id: "sess-003",
            timestamp: "2026-05-18T10:00:00Z",
            cwd: "/workspace",
          }) +
          "\n" +
          JSON.stringify({
            type: "custom_message",
            id: "msg-200",
            customType: "athena:event",
            content: "私聊消息内容",
            details: {
              version: 1,
              id: "msg-200",
              kind: "chat_message",
              timestamp: 1779148800000,
              source: { platform: "onebot", channelId: "private-789", conversationType: "private" },
              actor: { id: "user-alice", name: "Alice" },
              payload: { messageId: "msg-200", content: "私聊消息内容" },
            },
          }) +
          "\n",
      },
      meta: {
        platform: "onebot",
        channel: "private-789",
        type: "private",
        current_session: "sess-003",
        updated_at: "2026-05-18T10:01:00Z",
      },
    });

    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "Alice" });

    expect(result.text).toContain("## onebot:private-789 (private)");
  });

  it("includes both user and assistant messages as context", async () => {
    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "Alice" });
    // assistant 消息应该作为上下文出现
    expect(result.text).toContain("assistant");
  });
});
