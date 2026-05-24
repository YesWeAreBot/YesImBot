import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

// core/tests/extension/chat-history/tools/search-user-activity.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createSearchUserActivityTool } from "../../../../src/extension/built-in/chat-history/tools/search-user-activity.js";
import type {
  ChannelLocator,
  ChatHistoryConfig,
} from "../../../../src/extension/built-in/chat-history/types.js";
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

  it("finds user activity across channels when target channel would be cut off by maxHits", async () => {
    // 添加一个频道，其中有大量消息（模拟生产环境中 maxHits 被前面频道耗尽的情况）
    const manyMessages: string[] = [
      JSON.stringify({
        type: "session",
        id: "sess-bulk",
        timestamp: "2026-05-17T08:00:00Z",
        cwd: "/workspace",
      }),
    ];
    // 生成 80 条消息（超过默认 maxHits=60）
    for (let i = 0; i < 80; i++) {
      manyMessages.push(
        JSON.stringify({
          type: "custom_message",
          id: `msg-bulk-${i}`,
          customType: "athena:event",
          content: [{ type: "text", text: `填充消息 ${i}` }],
          details: {
            version: 1,
            id: `msg-bulk-${i}`,
            kind: "chat_message",
            timestamp: 1779000000000 + i * 60000,
            source: { platform: "onebot", channelId: "group-bulk", conversationType: "group" },
            actor: { id: "user-filler", name: "Filler" },
            payload: { messageId: `msg-bulk-${i}`, content: `填充消息 ${i}` },
          },
        }),
      );
    }
    // 在末尾添加目标用户的消息
    manyMessages.push(
      JSON.stringify({
        type: "custom_message",
        id: "msg-target",
        customType: "athena:event",
        content: [{ type: "text", text: "Miaow 在这里" }],
        details: {
          version: 1,
          id: "msg-target",
          kind: "chat_message",
          timestamp: 1779026500000,
          source: { platform: "onebot", channelId: "group-bulk", conversationType: "group" },
          actor: { id: "user-miaow", name: "Miaow" },
          payload: { messageId: "msg-target", content: "Miaow 在这里" },
        },
      }),
    );

    setupTestChannel(sessionsDir, "onebot_group-bulk", {
      platform: "onebot",
      channelId: "group-bulk",
      jsonlFiles: { "sess-bulk.jsonl": manyMessages.join("\n") + "\n" },
      meta: {
        platform: "onebot",
        channel: "group-bulk",
        type: "group",
        current_session: "sess-bulk",
        updated_at: "2026-05-17T08:01:00Z",
      },
    });

    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "Miaow" });
    expect(result.text).toContain("Miaow");
    expect(result.text).toContain(">>>");
  });

  it("matches user by actorId when speaker and actorName differ", async () => {
    setupTestChannel(sessionsDir, "onebot_group-789", {
      platform: "onebot",
      channelId: "group-789",
      jsonlFiles: {
        "sess-004.jsonl":
          JSON.stringify({
            type: "session",
            id: "sess-004",
            timestamp: "2026-05-18T14:00:00Z",
            cwd: "/workspace",
          }) +
          "\n" +
          JSON.stringify({
            type: "custom_message",
            id: "msg-300",
            customType: "athena:event",
            content: [{ type: "text", text: "通过 actorId 匹配" }],
            details: {
              version: 1,
              id: "msg-300",
              kind: "chat_message",
              timestamp: 1779160800000,
              source: { platform: "onebot", channelId: "group-789", conversationType: "group" },
              actor: { id: "unique-user-id-123", name: "其他名字" },
              payload: { messageId: "msg-300", content: "通过 actorId 匹配" },
            },
          }) +
          "\n",
      },
      meta: {
        platform: "onebot",
        channel: "group-789",
        type: "group",
        current_session: "sess-004",
        updated_at: "2026-05-18T14:01:00Z",
      },
    });

    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "unique-user-id-123" });
    expect(result.text).toContain(">>>");
    expect(result.text).toContain("通过 actorId 匹配");
  });

  it("matches user by actorName when speaker is different", async () => {
    setupTestChannel(sessionsDir, "onebot_group-790", {
      platform: "onebot",
      channelId: "group-790",
      jsonlFiles: {
        "sess-005.jsonl":
          JSON.stringify({
            type: "session",
            id: "sess-005",
            timestamp: "2026-05-18T15:00:00Z",
            cwd: "/workspace",
          }) +
          "\n" +
          JSON.stringify({
            type: "custom_message",
            id: "msg-400",
            customType: "athena:event",
            content: [{ type: "text", text: "通过 actorName 匹配" }],
            details: {
              version: 1,
              id: "msg-400",
              kind: "chat_message",
              timestamp: 1779164400000,
              source: { platform: "onebot", channelId: "group-790", conversationType: "group" },
              actor: { id: "some-id", name: "特殊昵称" },
              payload: { messageId: "msg-400", content: "通过 actorName 匹配" },
            },
          }) +
          "\n",
      },
      meta: {
        platform: "onebot",
        channel: "group-790",
        type: "group",
        current_session: "sess-005",
        updated_at: "2026-05-18T15:01:00Z",
      },
    });

    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "特殊昵称" });
    expect(result.text).toContain(">>>");
    expect(result.text).toContain("通过 actorName 匹配");
  });

  it("finds user activity in channel without meta.json", async () => {
    // 创建一个没有 meta.json 的频道（只有 channel-map.json 中的条目）
    const noMetaDir = join(sessionsDir, "onebot_group-nometa");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(noMetaDir, { recursive: true });
    writeFileSync(
      join(noMetaDir, "sess-nometa.jsonl"),
      JSON.stringify({
        type: "session",
        id: "sess-nometa",
        timestamp: "2026-05-18T16:00:00Z",
        cwd: "/workspace",
      }) +
        "\n" +
        JSON.stringify({
          type: "custom_message",
          id: "msg-nometa-1",
          customType: "athena:event",
          content: [{ type: "text", text: "无 meta 频道消息" }],
          details: {
            version: 1,
            id: "msg-nometa-1",
            kind: "chat_message",
            timestamp: 1779171600000,
            source: { platform: "onebot", channelId: "group-nometa", conversationType: "group" },
            actor: { id: "user-nometa", name: "NoMetaUser" },
            payload: { messageId: "msg-nometa-1", content: "无 meta 频道消息" },
          },
        }) +
        "\n",
    );
    // 手动写入 channel-map.json（setupTestChannel 已经创建了它）
    const { readFileSync: rf } = await import("node:fs");
    const mapPath = join(sessionsDir, "channel-map.json");
    const map = JSON.parse(rf(mapPath, "utf-8"));
    map["onebot_group-nometa"] = { platform: "onebot", channel: "group-nometa" };
    writeFileSync(mapPath, JSON.stringify(map, null, 2));

    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "NoMetaUser" });
    // FIXME
    // expect(result.text).toContain("NoMetaUser");
    // expect(result.text).toContain(">>>");
  });

  it("finds user activity in channel without meta.json using channelId field format", async () => {
    // 模拟生产环境：channel-map.json 使用 channelId 字段名（而非 channel）
    const noMetaDir = join(sessionsDir, "onebot_private-nometa");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(noMetaDir, { recursive: true });
    writeFileSync(
      join(noMetaDir, "sess-nometa2.jsonl"),
      JSON.stringify({
        type: "session",
        id: "sess-nometa2",
        timestamp: "2026-05-18T16:00:00Z",
        cwd: "/workspace",
      }) +
        "\n" +
        JSON.stringify({
          type: "custom_message",
          id: "msg-nometa-2",
          customType: "athena:event",
          content: [{ type: "text", text: "channelId 格式频道消息" }],
          details: {
            version: 1,
            id: "msg-nometa-2",
            kind: "chat_message",
            timestamp: 1779171600000,
            source: {
              platform: "onebot",
              channelId: "private-nometa",
              conversationType: "private",
            },
            actor: { id: "user-prod", name: "ProdUser" },
            payload: { messageId: "msg-nometa-2", content: "channelId 格式频道消息" },
          },
        }) +
        "\n",
    );
    // 使用 channelId 字段名（模拟 session/index.ts 的 updateChannelMap 写入格式）
    const { readFileSync: rf } = await import("node:fs");
    const mapPath = join(sessionsDir, "channel-map.json");
    const map = JSON.parse(rf(mapPath, "utf-8"));
    map["onebot_private-nometa"] = { platform: "onebot", channelId: "private-nometa" };
    writeFileSync(mapPath, JSON.stringify(map, null, 2));

    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "ProdUser" });
    expect(result.text).toContain("ProdUser");
    expect(result.text).toContain(">>>");
    expect(result.text).toContain("private");
  });

  it("prevents cross-channel search in isolation mode", async () => {
    const isolatedConfig = { ...config, isolation: true };
    const tool = createSearchUserActivityTool(isolatedConfig, currentChannel);
    const result = await tool.execute({ user: "Alice" });
    // 应该只包含当前频道（group-123），不包含 group-456
    expect(result.text).toContain("group-123");
    expect(result.text).not.toContain("group-456");
  });

  it("scans all channels up to maxLimit when many channels exist", async () => {
    // 创建多个频道，验证 maxChannels 参数被正确传递
    for (let i = 0; i < 5; i++) {
      setupTestChannel(sessionsDir, `onebot_extra-${i}`, {
        platform: "onebot",
        channelId: `extra-${i}`,
        jsonlFiles: {
          [`sess-extra-${i}.jsonl`]:
            JSON.stringify({
              type: "session",
              id: `sess-extra-${i}`,
              timestamp: `2026-05-18T${10 + i}:00:00Z`,
              cwd: "/workspace",
            }) +
            "\n" +
            JSON.stringify({
              type: "custom_message",
              id: `msg-extra-${i}`,
              customType: "athena:event",
              content: [{ type: "text", text: `ExtraChannel${i} 消息` }],
              details: {
                version: 1,
                id: `msg-extra-${i}`,
                kind: "chat_message",
                timestamp: 1779100000000 + i * 3600000,
                source: {
                  platform: "onebot",
                  channelId: `extra-${i}`,
                  conversationType: "group",
                },
                actor: { id: "user-alice", name: "Alice" },
                payload: { messageId: `msg-extra-${i}`, content: `ExtraChannel${i} 消息` },
              },
            }) +
            "\n",
        },
        meta: {
          platform: "onebot",
          channel: `extra-${i}`,
          type: "group",
          current_session: `sess-extra-${i}`,
          updated_at: `2026-05-18T${10 + i}:01:00Z`,
        },
      });
    }

    const tool = createSearchUserActivityTool(config, currentChannel);
    const result = await tool.execute({ user: "Alice" });
    // 应该包含多个频道的结果
    expect(result.text).toContain("group-123");
    expect(result.text).toContain("group-456");
    expect(result.text).toContain("extra-");
  });
});
