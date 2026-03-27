import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LanguageModel } from "ai";
import type { Bot, Context, Logger } from "koishi";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => {
  class ToolLoopAgent {
    constructor(_options: unknown) {}

    async generate(_input: unknown): Promise<void> {}
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

import { ChannelAgent } from "../../src/services/session/channel-agent";
import { AgentSessionService } from "../../src/services/session/service";
import { SessionManager } from "../../src/services/session/session-manager";
import type { ChannelEvent } from "../../src/services/session/types";

function createLoggerMock(): Logger {
  return {
    level: 2,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createContextMock(baseDir: string): Context {
  return {
    baseDir,
    logger: vi.fn(() => createLoggerMock()),
    "yesimbot.model": {
      resolve: vi.fn(() => ({}) as unknown as LanguageModel),
    },
  } as unknown as Context;
}

function createBotMock(selfId = "bot-self"): Bot {
  return {
    selfId,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Bot;
}

function createEvent(overrides: Partial<ChannelEvent> = {}): ChannelEvent {
  const bot = createBotMock();
  return {
    platform: "discord",
    channelId: "channel-1",
    userId: "user-1",
    username: "alice",
    content: "hello",
    isDirect: false,
    atSelf: false,
    isReplyToBot: false,
    messageId: "msg-1",
    timestamp: Date.now(),
    elements: [],
    bot,
    ...overrides,
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("AgentSessionService", () => {
  describe("event ingress", () => {
    it("persists before willingness", async () => {
      const ctx = createContextMock("/");
      const bot = createBotMock();
      const sessionManager = SessionManager.inMemory("discord:channel-1");
      const agent = new ChannelAgent(ctx, {
        bot,
        sessionManager,
        platform: "discord",
        channelId: "channel-1",
        modelId: "test:model",
        basePath: "/tmp/athena-test",
        instructions: "test instructions",
      });

      await agent.receive(createEvent({ bot }));

      expect(sessionManager.getEntryCount()).toBeGreaterThan(0);
      expect(bot.sendMessage).not.toHaveBeenCalled();
    });

    it("ignores self messages", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-self-"));
      tempDirs.push(tempDir);
      const ctx = createContextMock(tempDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });
      const getOrCreateAgentSpy = vi.spyOn(service, "getOrCreateAgent");
      const bot = createBotMock("bot-self");

      await service.receive(
        createEvent({
          bot,
          userId: "bot-self",
          messageId: "self-msg-1",
        }),
      );

      expect(getOrCreateAgentSpy).not.toHaveBeenCalled();
      expect(service.getActiveChannels()).toHaveLength(0);
    });

    it("dedupes message ids", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-dedupe-"));
      tempDirs.push(tempDir);
      const ctx = createContextMock(tempDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });
      const agentReceive = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(service, "getOrCreateAgent").mockReturnValue({
        receive: agentReceive,
      } as unknown as ChannelAgent);

      const event = createEvent({ messageId: "dup-msg-1" });
      await service.receive(event);
      await service.receive(event);

      expect(agentReceive).toHaveBeenCalledTimes(1);
    });
  });

  describe("output delivery", () => {
    it("channel-local delivery", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-channel-route-"));
      tempDirs.push(tempDir);
      const ctx = createContextMock(tempDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });
      const bot = createBotMock();
      const agentReceive = vi.fn().mockResolvedValue(undefined);
      const routeSpy = vi.spyOn(service, "getOrCreateAgent").mockReturnValue({
        receive: agentReceive,
      } as unknown as ChannelAgent);

      const event = createEvent({
        bot,
        platform: "discord",
        channelId: "origin-channel",
        messageId: "route-msg-1",
      });

      await service.receive(event);

      expect(routeSpy).toHaveBeenCalledWith("discord", "origin-channel", bot);
      expect(agentReceive).toHaveBeenCalledWith(event);
    });
  });
});
