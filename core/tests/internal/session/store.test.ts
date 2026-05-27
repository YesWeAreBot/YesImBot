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

import { encodeChannelId } from "../../../src/internal/session/encoding.js";
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

function createStore() {
  const basePath = createTempBasePath();
  const store = new SessionStore(createMockCtx() as never, { basePath, logLevel: 2 });
  return { store, basePath };
}

describe("SessionStore", () => {
  it("writes channel metadata without assignee", async () => {
    const { store, basePath } = createStore();

    await store.getOrCreate({
      platform: "onebot",
      channelId: "group-1",
      type: "group",
    });

    const meta = JSON.parse(
      readFileSync(
        join(basePath, "sessions", encodeChannelId("onebot", "group-1"), "meta.json"),
        "utf8",
      ),
    );
    expect(meta).toMatchObject({
      platform: "onebot",
      channel: "group-1",
      type: "group",
      session_count: 1,
    });
    expect(meta.assignee).toBeUndefined();
  });

  it("does not copy legacy assignee into new session metadata", async () => {
    const { store, basePath } = createStore();
    await store.getOrCreate({
      platform: "onebot",
      channelId: "group-1",
      type: "group",
    });
    const channelDir = join(basePath, "sessions", encodeChannelId("onebot", "group-1"));
    const metaPath = join(channelDir, "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    writeFileSync(metaPath, JSON.stringify({ ...meta, assignee: "bot-legacy" }));

    await store.newSession({
      platform: "onebot",
      channelId: "group-1",
      type: "group",
    });

    const nextMeta = JSON.parse(readFileSync(metaPath, "utf8"));
    expect(nextMeta.assignee).toBeUndefined();
    expect(nextMeta.session_count).toBe(2);
  });

  it("publishes internal session rotation without Koishi event emit", async () => {
    const { store } = createStore();
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
  });

  it("reopens existing session when metadata stores an absolute session path", async () => {
    const { store, basePath } = createStore();
    await store.getOrCreate({
      platform: "onebot",
      channelId: "group-1",
      type: "group",
    });

    const channelDir = join(basePath, "sessions", encodeChannelId("onebot", "group-1"));
    const metaPath = join(channelDir, "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    const sessionFile = join(channelDir, meta.current_session);
    writeFileSync(
      sessionFile,
      `${JSON.stringify({ type: "session", id: "restored-session", timestamp: new Date().toISOString() })}\n`,
    );
    writeFileSync(metaPath, JSON.stringify({ ...meta, current_session: sessionFile }));

    const restartedStore = new SessionStore(createMockCtx() as never, { basePath, logLevel: 2 });

    const restored = await restartedStore.getOrCreate({
      platform: "onebot",
      channelId: "group-1",
      type: "group",
    });

    expect(restored.getSessionFile()).toBe(sessionFile);
    expect(JSON.parse(readFileSync(metaPath, "utf8")).current_session).toBe(sessionFile);
  });
});
