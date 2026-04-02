import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LanguageModel } from "ai";
import type { Bot, Context, Logger } from "koishi";
import { afterEach, describe, expect, it, vi } from "vitest";

type GenerateInput = {
  messages: unknown[];
  abortSignal?: AbortSignal;
};

const generateMock = vi.fn<(input: GenerateInput) => Promise<void>>();

vi.mock("ai", () => {
  class ToolLoopAgent {
    readonly tools: Record<string, unknown> = {};

    constructor(_options: unknown) {}

    async generate(input: GenerateInput): Promise<void> {
      return generateMock(input);
    }
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
import { createTestSettingsManager } from "./test-settings-manager";

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

function createCommandContextMock(baseDir: string): {
  commands: Map<
    string,
    (argv: { session?: ChannelEvent; options?: Record<string, unknown> }) => unknown
  >;
  ctx: Context;
} {
  const commands = new Map<
    string,
    (argv: { session?: ChannelEvent; options?: Record<string, unknown> }) => unknown
  >();

  const ctx = {
    ...createContextMock(baseDir),
    middleware: vi.fn(),
    command: vi.fn((name: string) => {
      const builder = {
        option: vi.fn(() => builder),
        action: vi.fn((handler) => {
          commands.set(name, handler);
          return builder;
        }),
      };
      return builder;
    }),
  } as unknown as Context;

  return { commands, ctx };
}

async function startService(service: AgentSessionService): Promise<void> {
  return (service as unknown as { start(): Promise<void> }).start();
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
  generateMock.mockReset();
  vi.restoreAllMocks();
});

function createExistingWorkspace(baseDir: string, channelId = "channel-1"): void {
  const globalRoot = join(baseDir, "sessions");
  const channelDir = join(globalRoot, `discord-${channelId}`);
  const workspaceDir = join(channelDir, "workspace");

  rmSync(globalRoot, { recursive: true, force: true });
  mkdirSync(globalRoot, { recursive: true });
  writeFileSync(join(globalRoot, "settings.json"), JSON.stringify({ model: "test:model" }, null, 2));
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(join(channelDir, "settings.json"), JSON.stringify({ useGlobal: true }, null, 2));
}

describe("AgentSessionService", () => {
  describe("event ingress", () => {
    it("persists before willingness", async () => {
      const ctx = createContextMock("/");
      const bot = createBotMock();
      const sessionManager = SessionManager.inMemory("discord:channel-1");
      const agent = new ChannelAgent(ctx, {
        bot,
        sessionManager,
        settingsManager: createTestSettingsManager(),
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-test",
      });

      await agent.receive(createEvent({ bot }));

      expect(sessionManager.getEntryCount()).toBeGreaterThan(0);
      expect(bot.sendMessage).not.toHaveBeenCalled();
    });

    it("persists structured inbound channel_message header with reply summary", async () => {
      const ctx = createContextMock("/");
      const bot = createBotMock();
      const sessionManager = SessionManager.inMemory("discord:channel-1");
      const agent = new ChannelAgent(ctx, {
        bot,
        sessionManager,
        settingsManager: createTestSettingsManager(),
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-test",
      });

      await agent.receive(
        createEvent({
          bot,
          nickname: "Alice-Display",
          identity: "title:moderator",
          replyTo: {
            username: "yesimbot",
            nickname: "Athena",
            summary: "quoted summary",
          },
        }),
      );

      const persisted = sessionManager
        .getEntries()
        .find((entry) => entry.type === "custom_message" && entry.customType === "channel_message");

      expect(persisted).toBeTruthy();
      if (!persisted || persisted.type !== "custom_message") {
        return;
      }

      expect(typeof persisted.content).toBe("string");
      expect(persisted.content).toContain("[timestamp]");
      expect(persisted.content).toContain("[platform/channel]");
      expect(persisted.content).toContain("[sender]");
      expect(persisted.content).toContain("[context]");
      expect(persisted.content).toContain("[reply]");

      expect(persisted.details).toMatchObject({
        nickname: "Alice-Display",
        identity: "title:moderator",
        replyTo: {
          summary: "quoted summary",
        },
      });
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

    it("same-channel burst keeps one active turn plus one merged follow-up", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-single-turn-"));
      tempDirs.push(tempDir);
      const service = new AgentSessionService(createContextMock(tempDir), {
        model: "test:model",
        basePath: "sessions",
      });

      let releaseFirst!: () => void;
      const firstTurn = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      generateMock.mockImplementationOnce(async () => {
        await firstTurn;
      });
      generateMock.mockResolvedValueOnce();

      const first = service.receive(
        createEvent({ isDirect: true, messageId: "msg-burst-1", timestamp: 1000 }),
      );

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
      });

      const second = service.receive(
        createEvent({ isDirect: true, messageId: "msg-burst-2", timestamp: 1001 }),
      );
      const third = service.receive(
        createEvent({ isDirect: true, messageId: "msg-burst-3", timestamp: 1002 }),
      );

      releaseFirst();
      await Promise.all([first, second, third]);

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(2);
      });
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

  describe("manual compaction command", () => {
    it("reports when there is nothing eligible to compact", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-compact-command-"));
      tempDirs.push(tempDir);
      const { commands, ctx } = createCommandContextMock(tempDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });
      const runCompaction = vi.fn().mockResolvedValue({
        compacted: false,
        reason: "nothing-to-compact",
      });

      (service as unknown as { agents: Map<string, ChannelAgent> }).agents.set(
        "discord:channel-1",
        {
          runCompaction,
        } as unknown as ChannelAgent,
      );

      await startService(service);
      const action = commands.get("agent.compact");

      expect(action).toBeDefined();
      await expect(
        action?.({
          options: {
            platform: "discord",
            channel: "channel-1",
          },
        }),
      ).resolves.toBe("No compaction needed for discord:channel-1: nothing eligible to compact.");
    });

    it("uses configured contextWindow when --context is omitted", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-compact-context-"));
      tempDirs.push(tempDir);
      const { commands, ctx } = createCommandContextMock(tempDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
        contextWindow: 4096,
      });
      const runCompaction = vi.fn().mockResolvedValue({
        compacted: true,
      });

      (service as unknown as { agents: Map<string, ChannelAgent> }).agents.set(
        "discord:channel-1",
        {
          runCompaction,
        } as unknown as ChannelAgent,
      );

      await startService(service);
      const action = commands.get("agent.compact");

      expect(action).toBeDefined();
      await action?.({
        options: {
          platform: "discord",
          channel: "channel-1",
        },
      });

      expect(runCompaction).toHaveBeenCalledWith(4096);
    });

    it("bootstraps an existing workspace channel before the first user message", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-pre-message-compact-"));
      tempDirs.push(tempDir);
      createExistingWorkspace(tempDir);

      const { commands, ctx } = createCommandContextMock(tempDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });

      await startService(service);
      const action = commands.get("agent.compact");

      await expect(
        action?.({
          options: {
            platform: "discord",
            channel: "channel-1",
          },
        }),
      ).resolves.toBe("No compaction needed for discord:channel-1: session is empty.");
    });
  });
});
