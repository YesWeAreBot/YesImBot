// core/tests/extension/chat-history/engine/file-scanner.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { FileScanner } from "../../../../src/extension/chat-history/engine/file-scanner.js";
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
    const fixtureContent = readFileSync(
      join(FIXTURE_DIR, "sample-session.jsonl"),
      "utf-8",
    );
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
});
