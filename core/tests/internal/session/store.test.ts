import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@yesimbot/agent/session", () => {
  class MockSessionManager {
    static create = vi.fn((channelDir: string) => new MockSessionManager(channelDir));
    static open = vi.fn((sessionFile: string, channelDir: string) => {
      const manager = new MockSessionManager(channelDir);
      manager.sessionFile = sessionFile;
      return manager;
    });

    sessionFile: string;

    constructor(channelDir: string) {
      this.sessionFile = join(channelDir, "session-1.json");
      if (!existsSync(channelDir)) mkdirSync(channelDir, { recursive: true });
      if (!existsSync(this.sessionFile)) writeFileSync(this.sessionFile, "{}");
    }

    getSessionFile() {
      return this.sessionFile;
    }
  }

  return { SessionManager: MockSessionManager };
});

import { SessionStore } from "../../../src/internal/session/store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempBasePath() {
  const dir = mkdtempSync(join(tmpdir(), "athena-session-store-test-"));
  tempDirs.push(dir);
  return dir;
}

function createMockCtx() {
  return {
    logger: vi.fn().mockReturnValue({
      level: 2,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    command: vi.fn().mockReturnValue({ action: vi.fn() }),
  };
}

describe("SessionStore", () => {
  it("writes channel metadata, channel map, and assignee on first session", async () => {
    const basePath = createTempBasePath();
    const store = new SessionStore(createMockCtx() as never, { basePath, logLevel: 2 });

    await store.getOrCreate({
      platform: "onebot",
      channelId: "group-1",
      type: "group",
      assignee: "bot-2",
    });

    const channelDir = store.getChannelDir("onebot", "group-1");
    const meta = JSON.parse(readFileSync(join(channelDir, "meta.json"), "utf-8"));
    const channelMap = store.getChannelMap();

    expect(meta).toMatchObject({
      platform: "onebot",
      channel: "group-1",
      type: "group",
      session_count: 1,
      assignee: "bot-2",
    });
    expect(typeof meta.current_session).toBe("string");
    expect(meta.current_session.length).toBeGreaterThan(0);
    expect(channelMap[store.getChannelKey("onebot", "group-1")]).toEqual({
      platform: "onebot",
      channelId: "group-1",
    });
  });

  it("fills missing assignee without overwriting existing assignee", async () => {
    const basePath = createTempBasePath();
    const store = new SessionStore(createMockCtx() as never, { basePath, logLevel: 2 });
    const channelDir = store.getChannelDir("onebot", "group-1");
    mkdirSync(channelDir, { recursive: true });
    writeFileSync(join(channelDir, "session-1.json"), "{}");
    writeFileSync(
      join(channelDir, "meta.json"),
      JSON.stringify({
        platform: "onebot",
        channel: "group-1",
        type: "group",
        current_session: "session-1.json",
        last_message: "2026-05-25T00:00:00.000Z",
        updated_at: "2026-05-25T00:00:00.000Z",
        session_count: 1,
      }),
    );

    await store.getOrCreate({
      platform: "onebot",
      channelId: "group-1",
      type: "group",
      assignee: "bot-2",
    });
    let meta = JSON.parse(readFileSync(join(channelDir, "meta.json"), "utf-8"));
    expect(meta.assignee).toBe("bot-2");

    store.clearCachedManager("onebot", "group-1");
    writeFileSync(join(channelDir, "meta.json"), JSON.stringify({ ...meta, assignee: "bot-9" }));

    await store.getOrCreate({
      platform: "onebot",
      channelId: "group-1",
      type: "group",
      assignee: "bot-2",
    });
    meta = JSON.parse(readFileSync(join(channelDir, "meta.json"), "utf-8"));
    expect(meta.assignee).toBe("bot-9");
  });

  it("publishes internal session rotation without Koishi event emit", async () => {
    const basePath = createTempBasePath();
    const ctx = createMockCtx();
    const store = new SessionStore(ctx as never, { basePath, logLevel: 2 });
    const listener = vi.fn();

    store.subscribeSessionRotated(listener);
    const manager = await store.newSession({
      platform: "onebot",
      channelId: "group-1",
      type: "group",
    });

    expect(listener).toHaveBeenCalledWith({
      platform: "onebot",
      channelId: "group-1",
      type: "group",
      sessionManager: manager,
    });
    expect("emit" in ctx).toBe(false);
  });
});
