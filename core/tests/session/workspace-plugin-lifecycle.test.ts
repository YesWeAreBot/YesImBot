import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Bot, Context, Logger } from "koishi";
import { describe, expect, it, vi } from "vitest";

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
  const channelDir = join(globalRoot, `discord-${channelId}`);
  const workspaceDir = join(channelDir, "workspace");

  mkdirSync(globalRoot, { recursive: true });
  writeFileSync(join(globalRoot, "settings.json"), JSON.stringify({ model: "test:model" }, null, 2));
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(join(channelDir, "settings.json"), JSON.stringify({ useGlobal: true }, null, 2));
}

function createBotMock(selfId = "bot-self"): Bot {
  return {
    selfId,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Bot;
}

describe("workspace plugin lifecycle", () => {
  it("bootstrap awaits scoped workspace plugin installation before returning", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-workspace-bootstrap-"));
    try {
      const { ctx, install } = createContextMock(baseDir);
      createExistingWorkspace(baseDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
        enableWorkspace: true,
        enableFilesystem: true,
      });

      let resolveInstall!: () => void;
      install.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveInstall = resolve;
          }),
      );

      let settled = false;
      const bootstrapPromise = service
        .bootstrapChannelForManagement("discord", "channel-1", createBotMock())
        .then((result) => {
          settled = true;
          return result;
        });

      await Promise.resolve();

      expect(install).toHaveBeenCalledWith(expect.anything(), { scope: "discord:channel-1" });
      expect(settled).toBe(false);

      resolveInstall();

      await expect(bootstrapPromise).resolves.toMatchObject({
        channelKey: "discord:channel-1",
        status: "created",
      });
      expect(settled).toBe(true);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("reload waits for scoped workspace removal and reinstall before completing", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-workspace-reload-"));
    try {
      const { ctx, install, remove } = createContextMock(baseDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
        enableWorkspace: true,
        enableFilesystem: true,
      });

      await service.getOrCreateAgent("discord", "channel-1", createBotMock());
      await vi.waitFor(() => {
        expect(install).toHaveBeenCalled();
      });
      install.mockClear();
      remove.mockClear();

      let resolveInstall!: () => void;
      install.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveInstall = resolve;
          }),
      );

      let settled = false;
      const reloadPromise = service.reloadChannelSettings("discord", "channel-1", createBotMock()).then((result) => {
        settled = true;
        return result;
      });

      await Promise.resolve();

      expect(remove).toHaveBeenCalledWith("workspace", { scope: "discord:channel-1" });
      expect(install).toHaveBeenCalledWith(expect.anything(), { scope: "discord:channel-1" });
      expect(remove.mock.invocationCallOrder[0]).toBeLessThan(install.mock.invocationCallOrder[0]);
      expect(settled).toBe(false);

      resolveInstall();

      await expect(reloadPromise).resolves.toMatchObject({
        channelKey: "discord:channel-1",
        status: "reloaded",
      });
      expect(settled).toBe(true);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("dispose removes scoped workspace plugin", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-workspace-dispose-"));
    try {
      const { ctx, remove } = createContextMock(baseDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
        enableWorkspace: true,
        enableFilesystem: true,
      });

      const runtime = await service.getOrCreateAgent("discord", "channel-1", createBotMock());
      expect(runtime).toBeDefined();

      await vi.waitFor(() => {
        expect(remove).not.toHaveBeenCalled();
      });

      await (service as unknown as { stop(): Promise<void> }).stop();

      expect(remove).toHaveBeenCalledWith("workspace", { scope: "discord:channel-1" });
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  it("disabled workspace settings skip scoped workspace plugin installation", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "athena-workspace-disabled-"));
    try {
      const { ctx, install } = createContextMock(baseDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
        enableWorkspace: false,
        enableFilesystem: true,
      });

      await service.getOrCreateAgent("discord", "channel-1", createBotMock());

      expect(install).not.toHaveBeenCalled();
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
