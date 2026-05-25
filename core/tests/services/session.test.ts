import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("koishi", () => {
  class Service {
    ctx: unknown;
    [Symbol.for("koishi.tracker")]: unknown;

    constructor(ctx: unknown, _name: string) {
      this.ctx = ctx;
    }

    protected start() {}
    protected stop() {}
  }

  return {
    Context: class {},
    Logger: class {},
    Service,
  };
});

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

  return {
    SessionManager: MockSessionManager,
  };
});

import { SessionService } from "../../src/services/session/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
    emit: vi.fn(),
  };
}

function createTempBasePath() {
  const dir = mkdtempSync(join(tmpdir(), "athena-session-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("SessionService assignee metadata", () => {
  it("writes assignee when creating new metadata", async () => {
    const basePath = createTempBasePath();
    const service = new SessionService(createMockCtx() as never, { basePath, logLevel: 2 });

    await service.getOrCreate("onebot", "group-1", "group", "bot-2");

    const metaPath = join(service.getChannelDir("onebot", "group-1"), "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(meta.assignee).toBe("bot-2");
  });

  it("fills missing assignee without overwriting existing assignee", async () => {
    const basePath = createTempBasePath();
    const service = new SessionService(createMockCtx() as never, { basePath, logLevel: 2 });
    const channelDir = service.getChannelDir("onebot", "group-1");
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

    await service.getOrCreate("onebot", "group-1", "group", "bot-2");
    let meta = JSON.parse(readFileSync(join(channelDir, "meta.json"), "utf-8"));
    expect(meta.assignee).toBe("bot-2");

    service["managers"].delete("onebot:group-1");
    writeFileSync(
      join(channelDir, "meta.json"),
      JSON.stringify({
        ...meta,
        assignee: "bot-9",
      }),
    );

    await service.getOrCreate("onebot", "group-1", "group", "bot-2");
    meta = JSON.parse(readFileSync(join(channelDir, "meta.json"), "utf-8"));
    expect(meta.assignee).toBe("bot-9");
  });
});
