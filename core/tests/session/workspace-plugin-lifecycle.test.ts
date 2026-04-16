import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Bot, Context, Logger } from "koishi";
import { describe, expect, it, vi } from "vitest";

import {
  getChannelStateDir,
  getUserStateDir,
} from "../../src/services/session/instruction-state/layout";

vi.mock("ai", () => {
  class ToolLoopAgent {
    readonly tools: Record<string, unknown> = {};

    constructor(_options: unknown) {}

    async generate(): Promise<void> {}
  }

  return {
    ToolLoopAgent,
    stepCountIs: () => () => false,
  };
});

vi.mock("koishi", () => {
  class Service<TConfig = unknown> {
    protected ctx: unknown;
    protected config!: TConfig;
    protected logger: Logger;

    constructor(ctx: Context, name: string) {
      this.ctx = ctx;
      this.logger = ctx.logger(name);
    }
  }

  return {
    Service,
    Bot: class {},
    Context: class {},
    Session: class {},
  };
});

import { AgentSessionService } from "../../src/services/session/service";

function createLoggerMock(): Logger {
  return {
    level: 2,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createContextMock(baseDir: string) {
  const remove = vi.fn();
  const install = vi.fn().mockResolvedValue(undefined);

  return {
    ctx: {
      baseDir,
      logger: vi.fn(() => createLoggerMock()),
      on: vi.fn(),
      middleware: vi.fn(),
      command: vi.fn(() => {
        const builder = {
          option: vi.fn(() => builder),
          action: vi.fn(() => builder),
        };
        return builder;
      }),
      "yesimbot.model": {
        resolve: vi.fn(() => ({}) as never),
        resolveRegistration: vi.fn(),
      },
      "yesimbot.plugin": {
        install,
        remove,
      },
    } as unknown as Context,
    install,
    remove,
  };
}

function createExistingWorkspace(baseDir: string, channelId = "channel-1"): void {
  const globalRoot = join(baseDir, "sessions");
  const channelStateDir = getChannelStateDir(globalRoot, "discord", channelId);
  const workspaceDir = join(channelStateDir, "workspace");

  mkdirSync(globalRoot, { recursive: true });
  writeFileSync(
    join(globalRoot, "settings.json"),
    JSON.stringify({ model: "test:model" }, null, 2),
  );
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(join(channelStateDir, "settings.json"), JSON.stringify({}, null, 2));
}

function createBotMock(selfId = "bot-self"): Bot {
  return {
    selfId,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Bot;
}

function createChannelMessageInput(bot: Bot) {
  return {
    kind: "channel_message" as const,
    platform: "discord",
    channelId: "channel-1",
    sender: {
      userId: "user-1",
      username: "alice",
      nickname: "Alice",
    },
    content: "hello",
    isDirect: true,
    atSelf: true,
    isReplyToBot: true,
    messageId: "workspace-msg-1",
    timestamp: Date.now(),
    bot,
  };
}

describe("workspace plugin lifecycle", () => {
  it("receiving a message does not install a scoped workspace plugin", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-workspace-bootstrap-"));
    try {
      const { ctx, install } = createContextMock(baseDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });

      const bot = createBotMock();
      await service.receive(createChannelMessageInput(bot), bot);

      expect(install).not.toHaveBeenCalled();
      expect(service.getActiveChannels()).toEqual(["discord:channel-1"]);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("receiving a message creates only state directories, not legacy workspace scaffolding", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-workspace-scaffold-"));
    try {
      const { ctx } = createContextMock(baseDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });
      const bot = createBotMock();

      await service.receive(createChannelMessageInput(bot), bot);

      const globalRoot = join(baseDir, "sessions");
      const channelDir = join(globalRoot, "discord-channel-1");
      const channelStateDir = getChannelStateDir(globalRoot, "discord", "channel-1");
      const userStateDir = getUserStateDir(globalRoot, "discord", "user-1");

      expect(existsSync(globalRoot)).toBe(true);
      expect(existsSync(channelDir)).toBe(false);
      expect(existsSync(channelStateDir)).toBe(false);
      expect(existsSync(join(userStateDir, "session"))).toBe(true);
      expect(existsSync(join(channelDir, "workspace"))).toBe(false);
      expect(existsSync(join(globalRoot, "SOUL.md"))).toBe(false);
      expect(existsSync(join(globalRoot, "AGENTS.md"))).toBe(false);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("settings reload does not remove or reinstall a scoped workspace plugin", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-workspace-reload-"));
    try {
      const { ctx, install, remove } = createContextMock(baseDir);
      createExistingWorkspace(baseDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });
      const bot = createBotMock();

      await service.receive(createChannelMessageInput(bot), bot);
      install.mockClear();
      remove.mockClear();

      await expect(
        service.reloadChannelSettings("discord", "channel-1", createBotMock()),
      ).resolves.toMatchObject({
        channelKey: "discord:channel-1",
        status: "reloaded",
      });

      expect(remove).not.toHaveBeenCalled();
      expect(install).not.toHaveBeenCalled();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("settings reload does not bootstrap an inactive channel", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-workspace-reload-inactive-"));
    try {
      const { ctx, install, remove } = createContextMock(baseDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });

      await expect(
        service.reloadChannelSettings("discord", "channel-1", createBotMock()),
      ).resolves.toMatchObject({
        channelKey: "discord:channel-1",
        status: "failed",
        summary: "No active agent for discord:channel-1.",
      });

      expect(service.getActiveChannels()).toEqual([]);
      expect(remove).not.toHaveBeenCalled();
      expect(install).not.toHaveBeenCalled();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("service stop does not remove a scoped workspace plugin", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-workspace-dispose-"));
    try {
      const { ctx, remove } = createContextMock(baseDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });

      const bot = createBotMock();
      await service.receive(createChannelMessageInput(bot), bot);
      const runtime = service.getAgent("discord:channel-1");
      expect(runtime).toBeDefined();

      await (service as unknown as { stop(): Promise<void> }).stop();

      expect(remove).not.toHaveBeenCalled();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
