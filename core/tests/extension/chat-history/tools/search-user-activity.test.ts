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
            parentId: null,
            timestamp: "2026-05-17T12:01:00Z",
            customType: "athena:message",
            content: [{ type: "text", text: "Alice 在另一个频道说话" }],
            display: true,
            details: {
              senderId: "user-alice",
              kind: "message",
              actor: { userId: "user-alice", nickname: "Alice" },
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

  it("finds user activity across channels", async () => {
    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "Alice" });
    expect(result.activities.length).toBeGreaterThan(0);
  });

  it("groups results by channel", async () => {
    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "Alice" });
    const channels = result.activities.map((a) => a.channel);
    expect(new Set(channels).size).toBe(channels.length);
  });

  it("includes recent messages per channel (max 3)", async () => {
    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "Alice" });
    for (const activity of result.activities) {
      expect(activity.recent_messages.length).toBeLessThanOrEqual(3);
      expect(activity.recent_messages.length).toBeGreaterThan(0);
    }
  });

  it("returns hint when user not found", async () => {
    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "不存在的用户xyz" });
    expect(result.activities).toHaveLength(0);
    expect(result.hint).toBeDefined();
  });

  it("respects isolation mode", async () => {
    const isolatedConfig = { ...config, isolation: true };
    const tool = createSearchUserActivityTool(isolatedConfig, currentChannel);
    const result = await tool.execute({ user: "Alice" });
    expect(result.activities.every((a) => a.channel.includes("group-123"))).toBe(true);
  });

  it("filters by content query", async () => {
    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "Alice", query: "项目进度" });
    expect(result.activities.length).toBeGreaterThan(0);
  });
});
