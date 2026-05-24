import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

// core/tests/extension/chat-history/engine/file-scanner.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { FileScanner } from "../../../../src/extension/built-in/chat-history/engine/file-scanner.js";
import {
  createTempSessionsDir,
  setupTestChannel,
  makeSearchContext,
  FIXTURE_DIR,
} from "../fixtures/helpers.js";

describe("FileScanner", () => {
  let sessionsDir: string;

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
  });

  afterEach(() => {
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  it("scans channel and returns matching messages", async () => {
    const ctx = makeSearchContext(sessionsDir);
    const scanner = new FileScanner(ctx);
    const results = await scanner.scan(
      [{ channelKey: "onebot_group-123", platform: "onebot", channelId: "group-123" }],
      { contentMatcher: (c) => c.toLowerCase().includes("docker") },
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.content.toLowerCase().includes("docker"))).toBe(true);
  });

  it("attaches channelKey to results", async () => {
    const ctx = makeSearchContext(sessionsDir);
    const scanner = new FileScanner(ctx);
    const results = await scanner.scan(
      [{ channelKey: "onebot_group-123", platform: "onebot", channelId: "group-123" }],
      {},
    );
    expect(results.every((r) => r.channelKey === "onebot_group-123")).toBe(true);
  });

  it("respects maxHits across files", async () => {
    const ctx = makeSearchContext(sessionsDir);
    const scanner = new FileScanner(ctx);
    const results = await scanner.scan(
      [{ channelKey: "onebot_group-123", platform: "onebot", channelId: "group-123" }],
      { maxHits: 3 },
    );
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("respects maxFilesPerChannel", async () => {
    const ctx = makeSearchContext(sessionsDir);
    const scanner = new FileScanner(ctx);
    const results = await scanner.scan(
      [{ channelKey: "onebot_group-123", platform: "onebot", channelId: "group-123" }],
      { maxFilesPerChannel: 1 },
    );
    expect(results.length).toBeGreaterThan(0);
  });

  it("filters by time range using file mtime", async () => {
    const ctx = makeSearchContext(sessionsDir);
    const scanner = new FileScanner(ctx);
    const results = await scanner.scan(
      [{ channelKey: "onebot_group-123", platform: "onebot", channelId: "group-123" }],
      { since: new Date("2030-01-01").getTime() },
    );
    expect(results.length).toBe(0);
  });

  it("filters by sender matcher", async () => {
    const ctx = makeSearchContext(sessionsDir);
    const scanner = new FileScanner(ctx);
    const results = await scanner.scan(
      [{ channelKey: "onebot_group-123", platform: "onebot", channelId: "group-123" }],
      { senderMatcher: (msg) => msg.speaker === "Alice" },
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.speaker === "Alice")).toBe(true);
  });
});

describe("compactionSummary 排除", () => {
  let compactionSessionsDir: string;

  beforeEach(() => {
    compactionSessionsDir = createTempSessionsDir();
    const fixtureContent = readFileSync(join(FIXTURE_DIR, "compaction-scenario.jsonl"), "utf-8");
    setupTestChannel(compactionSessionsDir, "test_ch-1", {
      platform: "test",
      channelId: "ch-1",
      jsonlFiles: { "compaction-test-session.jsonl": fixtureContent },
      meta: {
        platform: "test",
        channel: "ch-1",
        type: "private",
        current_session: "compaction-test-session",
        updated_at: "2026-05-19T09:05:00Z",
      },
    });
  });

  afterEach(() => {
    rmSync(compactionSessionsDir, { recursive: true, force: true });
  });

  it("当前会话文件中 compactionSummary 之后的消息被排除", async () => {
    const ctx = makeSearchContext(compactionSessionsDir, {
      currentSessionId: "compaction-test-session",
    });
    const scanner = new FileScanner(ctx);
    const results = await scanner.scan(
      [
        {
          channelKey: "test_ch-1",
          platform: "test",
          channelId: "ch-1",
          currentSessionId: "compaction-test-session",
        },
      ],
      { contentMatcher: () => true },
    );

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("evt-before-1");
    expect(results[1].id).toBe("evt-before-2");
  });

  it("当前会话文件中 compactionSummary 之前的消息可返回", async () => {
    const ctx = makeSearchContext(compactionSessionsDir, {
      currentSessionId: "compaction-test-session",
    });
    const scanner = new FileScanner(ctx);
    const results = await scanner.scan(
      [
        {
          channelKey: "test_ch-1",
          platform: "test",
          channelId: "ch-1",
          currentSessionId: "compaction-test-session",
        },
      ],
      { contentMatcher: (content) => content.includes("旧消息") },
    );

    expect(results).toHaveLength(2);
  });

  it("其他会话文件中的消息可返回（无 compactionSummary 排除）", async () => {
    const ctx = makeSearchContext(compactionSessionsDir, {
      currentSessionId: "other-session-id",
    });
    const scanner = new FileScanner(ctx);
    const results = await scanner.scan(
      [{ channelKey: "test_ch-1", platform: "test", channelId: "ch-1" }],
      { contentMatcher: () => true },
    );

    expect(results).toHaveLength(4);
  });

  it("无 compactionSummary 时全量搜索当前会话文件", async () => {
    const noCompactionDir = createTempSessionsDir();
    const noCompactionContent = `{"type":"session","id":"no-compaction-session","timestamp":"2026-05-19T09:00:00.000Z","cwd":"/tmp"}
{"type":"custom_message","id":"msg-1","timestamp":"2026-05-19T09:01:00.000Z","customType":"athena:event","content":"消息1","display":true,"details":{"version":1,"id":"evt-1","kind":"chat_message","timestamp":1779181260000,"source":{"platform":"test","channelId":"ch-1","conversationType":"private"},"actor":{"id":"user-1","name":"Alice"},"payload":{"messageId":"m-1","content":"消息1"}}}
{"type":"custom_message","id":"msg-2","timestamp":"2026-05-19T09:02:00.000Z","customType":"athena:event","content":"消息2","display":true,"details":{"version":1,"id":"evt-2","kind":"chat_message","timestamp":1779181320000,"source":{"platform":"test","channelId":"ch-1","conversationType":"private"},"actor":{"id":"user-1","name":"Alice"},"payload":{"messageId":"m-2","content":"消息2"}}}`;

    setupTestChannel(noCompactionDir, "test_ch-1", {
      platform: "test",
      channelId: "ch-1",
      jsonlFiles: { "no-compaction-session.jsonl": noCompactionContent },
      meta: {
        platform: "test",
        channel: "ch-1",
        type: "private",
        current_session: "no-compaction-session",
        updated_at: "2026-05-19T09:02:00Z",
      },
    });

    const ctx = makeSearchContext(noCompactionDir, {
      currentSessionId: "no-compaction-session",
    });
    const scanner = new FileScanner(ctx);
    const results = await scanner.scan(
      [{ channelKey: "test_ch-1", platform: "test", channelId: "ch-1" }],
      { contentMatcher: () => true },
    );

    expect(results).toHaveLength(2);

    rmSync(noCompactionDir, { recursive: true, force: true });
  });
});
