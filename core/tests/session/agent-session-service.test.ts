import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LanguageModel } from "ai";
import type { Bot, Context, Logger } from "koishi";
import { afterEach, describe, expect, it, vi } from "vitest";

type GenerateInput = {
  messages: unknown[];
  abortSignal?: AbortSignal;
  tools?: Record<string, unknown>;
};

const generateMock = vi.fn<(input: GenerateInput) => Promise<void>>();

vi.mock("ai", () => {
  class ToolLoopAgent {
    readonly tools: Record<string, unknown> = {};

    constructor(_options: unknown) {}

    async generate(input: GenerateInput): Promise<void> {
      return generateMock({
        ...input,
        tools: { ...this.tools },
      });
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

import { ChannelRuntime } from "../../src/services/session/runtime";
import { AgentSessionService } from "../../src/services/session/service";
import { SessionManager } from "../../src/services/session/session-manager";
import type { ChannelMessageInput } from "../../src/services/session/types/index";
import type { WillingnessJudge } from "../../src/services/session/willingness";
import { createTestSettingsManager } from "./test-settings-manager";

type TestChannelMessageInput = ChannelMessageInput & {
  bot?: Bot;
  userId: string;
  username: string;
  nickname?: string;
  identity?: string;
};

function createLoggerMock(): Logger {
  return {
    level: 2,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

interface PluginServiceMockOptions {
  compileTools?: (request: { sendMessageTool?: Record<string, unknown> }) => Promise<{
    tools: Record<string, unknown>;
    handles: Record<string, unknown>;
    signature: string;
  }>;
  buildResponseContext?: () => Promise<Record<string, unknown>>;
  selectTools?: (request: {
    runtime?: unknown;
    scope?: string;
    catalog: { tools: Record<string, unknown> };
    responseContext: Record<string, unknown>;
    toolSettings?: { enabled?: string[] };
  }) => Promise<{
    activeTools: Record<string, unknown>;
    activeToolNames: string[];
    responseContext: Record<string, unknown>;
  }>;
  getToolDefinitions?: () => unknown[];
  getInstructionContributors?: () => unknown[];
  install?: (plugin: unknown, options?: { scope?: string }) => Promise<void>;
  remove?: (name: string, options?: { scope?: string }) => void;
}

function createContextMock(
  baseDir: string,
  pluginOptions: PluginServiceMockOptions | null = {},
): Context {
  const loggers = new Map<string, Logger>();
  const ctx = {
    baseDir,
    logger: vi.fn((name: string) => {
      const existing = loggers.get(name);
      if (existing) {
        return existing;
      }

      const logger = createLoggerMock();
      loggers.set(name, logger);
      return logger;
    }),
    "yesimbot.model": {
      resolveRegistration: vi.fn((fullId: string) => ({
        fullId,
        providerId: "test",
        modelId: "model",
        entry: {
          id: "model",
          toolCall: true,
          reasoning: false,
        },
        model: {} as LanguageModel,
      })),
      resolve: vi.fn(() => ({}) as unknown as LanguageModel),
    },
  } as Record<string, unknown>;

  if (pluginOptions !== null) {
    ctx["yesimbot.plugin"] = {
      compileTools: vi.fn(
        pluginOptions.compileTools ??
          (async (request: { sendMessageTool?: Record<string, unknown> }) => {
            const sendMessageTool = request.sendMessageTool;
            const tools = sendMessageTool ? { send_message: sendMessageTool } : {};

            return {
              tools,
              handles: {},
              signature: JSON.stringify(Object.keys(tools).sort()),
            };
          }),
      ),
      buildResponseContext: vi.fn(pluginOptions.buildResponseContext ?? (async () => ({}))),
      selectTools: vi.fn(
        pluginOptions.selectTools ??
          (async (request: {
            runtime?: unknown;
            scope?: string;
            catalog: { tools: Record<string, unknown> };
            responseContext: Record<string, unknown>;
            toolSettings?: { enabled?: string[] };
          }) => {
            const activeTools = Object.fromEntries(
              Object.entries(request.catalog.tools).filter(([name]) => {
                return request.toolSettings?.enabled?.includes(name) ?? true;
              }),
            );

            return {
              activeTools,
              activeToolNames: Object.keys(activeTools),
              responseContext: request.responseContext,
            };
          }),
      ),
      getToolDefinitions: vi.fn(pluginOptions.getToolDefinitions ?? (() => [])),
      getInstructionContributors: vi.fn(pluginOptions.getInstructionContributors ?? (() => [])),
      install: vi.fn(pluginOptions.install ?? (async () => undefined)),
      remove: vi.fn(pluginOptions.remove ?? (() => undefined)),
    };
  }

  return ctx as unknown as Context;
}

function createCommandContextMock(
  baseDir: string,
  pluginOptions: PluginServiceMockOptions | null = {},
): {
  commands: Map<
    string,
    (argv: { session?: ChannelMessageInput; options?: Record<string, unknown> }) => unknown
  >;
  ctx: Context;
} {
  const commands = new Map<
    string,
    (argv: { session?: ChannelMessageInput; options?: Record<string, unknown> }) => unknown
  >();

  const ctx = {
    ...createContextMock(baseDir, pluginOptions),
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

function createChannelMessageInput(
  overrides: Partial<TestChannelMessageInput> = {},
): TestChannelMessageInput {
  const {
    bot = createBotMock(),
    userId = "user-1",
    username = "alice",
    nickname,
    identity,
    sender,
    ...rest
  } = overrides;
  return {
    kind: "channel_message",
    platform: "discord",
    channelId: "channel-1",
    sender: {
      userId,
      username,
      nickname,
      identity,
      ...sender,
    },
    content: "hello",
    isDirect: false,
    atSelf: false,
    isReplyToBot: false,
    messageId: "msg-1",
    timestamp: Date.now(),
    bot,
    userId,
    username,
    nickname,
    identity,
    ...rest,
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

describe("AgentSessionService", () => {
  describe("event ingress", () => {
    it("instruction runtime environment block is included in generated system prompt", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-instruction-runtime-environment-"));
      tempDirs.push(tempDir);
      const ctx = createContextMock(tempDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });
      const bot = createBotMock();

      generateMock.mockResolvedValueOnce();

      await service.receive(
        createChannelMessageInput({
          bot,
          isDirect: true,
          atSelf: true,
          isReplyToBot: true,
          messageId: "instruction-msg-1",
          sender: {
            userId: "user-1",
            username: "alice",
            nickname: "Alice",
            identity: "title:moderator",
          },
          replyTo: {
            username: "yesimbot",
            nickname: "Athena",
            summary: "quoted",
          },
        }),
        bot,
      );

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
      });

      const systemMessage = (
        generateMock.mock.calls[0]?.[0]?.messages as Array<{ role?: string; content?: unknown }>
      )?.[0];
      expect(systemMessage?.role).toBe("system");
      expect(typeof systemMessage?.content).toBe("string");
      if (typeof systemMessage?.content !== "string") {
        return;
      }

      expect(systemMessage.content).toContain("## Runtime Environment");
      expect(systemMessage.content).toContain("Platform: discord");
      expect(systemMessage.content).toContain("Conversation type: private");
      expect(systemMessage.content).toContain("Mentioned bot: yes");
      expect(systemMessage.content).toContain("Reply-to-bot: yes");
    });

    it("persists before willingness", async () => {
      const ctx = createContextMock("/");
      const bot = createBotMock();
      const sessionManager = SessionManager.inMemory("discord:channel-1");
      const agent = new ChannelRuntime(ctx, {
        bot,
        sessionManager,
        settingsManager: createTestSettingsManager(),
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-test",
      });

      await agent.receive(createChannelMessageInput({ bot }));

      expect(sessionManager.getEntryCount()).toBeGreaterThan(0);
      expect(bot.sendMessage).not.toHaveBeenCalled();
    });

    it("uses runtime heuristic first and skips deferred judge for direct messages", async () => {
      const ctx = createContextMock("/");
      const bot = createBotMock();
      const sessionManager = SessionManager.inMemory("discord:channel-1");
      const deferredJudge: WillingnessJudge = {
        judge: vi.fn().mockResolvedValue({ shouldRespond: false, reason: "no_trigger" }),
      };
      const agent = new ChannelRuntime(ctx, {
        bot,
        sessionManager,
        settingsManager: createTestSettingsManager(),
        willingnessJudge: deferredJudge,
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-test",
      });

      generateMock.mockResolvedValueOnce();
      await agent.receive(
        createChannelMessageInput({ bot, isDirect: true, atSelf: false, isReplyToBot: false }),
      );

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
      });
      expect(deferredJudge.judge).not.toHaveBeenCalled();
    });

    it("falls back to deferred judge for gray-zone messages", async () => {
      const ctx = createContextMock("/");
      const bot = createBotMock();
      const sessionManager = SessionManager.inMemory("discord:channel-1");
      const deferredJudge: WillingnessJudge = {
        judge: vi.fn().mockResolvedValue({ shouldRespond: false, reason: "no_trigger" }),
      };
      const agent = new ChannelRuntime(ctx, {
        bot,
        sessionManager,
        settingsManager: createTestSettingsManager(),
        willingnessJudge: deferredJudge,
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-test",
      });

      await agent.receive(
        createChannelMessageInput({ bot, isDirect: false, atSelf: false, isReplyToBot: false }),
      );

      expect(deferredJudge.judge).toHaveBeenCalledTimes(1);
      expect(sessionManager.getEntryCount()).toBeGreaterThan(0);
      expect(generateMock).not.toHaveBeenCalled();
    });

    it("persists structured inbound channel_message header with reply summary", async () => {
      const ctx = createContextMock("/");
      const bot = createBotMock();
      const sessionManager = SessionManager.inMemory("discord:channel-1");
      const agent = new ChannelRuntime(ctx, {
        bot,
        sessionManager,
        settingsManager: createTestSettingsManager(),
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-test",
      });

      await agent.receive(
        createChannelMessageInput({
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
        .getTimeline()
        .find((record) => record.kind === "channel_message");

      expect(persisted).toBeTruthy();
      if (!persisted || persisted.kind !== "channel_message") {
        return;
      }

      expect(persisted.message.sender).toMatchObject({
        nickname: "Alice-Display",
        identity: "title:moderator",
      });
      expect(persisted.message.replyTo).toMatchObject({
        summary: "quoted summary",
      });

      const modelMessage = sessionManager.getModelMessages()[0];
      expect(modelMessage).toMatchObject({ role: "user" });
      expect(modelMessage?.content).toEqual(expect.any(String));
      if (typeof modelMessage?.content !== "string") {
        return;
      }

      expect(modelMessage.content).toContain("[timestamp]");
      expect(modelMessage.content).toContain("[platform/channel]");
      expect(modelMessage.content).toContain("[sender]");
      expect(modelMessage.content).toContain("[context]");
      expect(modelMessage.content).toContain("[reply]");
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
        createChannelMessageInput({
          bot,
          userId: "bot-self",
          messageId: "self-msg-1",
        }),
        bot,
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
      } as unknown as ChannelRuntime);

      const event = createChannelMessageInput({ messageId: "dup-msg-1" });
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
      const bot = createBotMock();

      let releaseFirst!: () => void;
      const firstTurn = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      generateMock.mockImplementationOnce(async () => {
        await firstTurn;
      });
      generateMock.mockResolvedValueOnce();

      const first = service.receive(
        createChannelMessageInput({
          bot,
          isDirect: true,
          messageId: "msg-burst-1",
          timestamp: 1000,
        }),
        bot,
      );

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
      });

      const second = service.receive(
        createChannelMessageInput({
          bot,
          isDirect: true,
          messageId: "msg-burst-2",
          timestamp: 1001,
        }),
        bot,
      );
      const third = service.receive(
        createChannelMessageInput({
          bot,
          isDirect: true,
          messageId: "msg-burst-3",
          timestamp: 1002,
        }),
        bot,
      );

      expect(service.getActiveChannels()).toEqual(["discord:channel-1"]);

      releaseFirst();
      await Promise.all([first, second, third]);

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(2);
      });

      expect(service.getActiveChannels()).toEqual(["discord:channel-1"]);

      const runtime = service.getAgent("discord:channel-1");
      expect(runtime).toBeDefined();
      const timeline = runtime?.sessionManager.getTimeline() ?? [];
      const channelMessages = timeline.filter((record) => record.kind === "channel_message");
      const followUpReviews = timeline.filter(
        (record) => record.kind === "state_change" && record.stateType === "follow_up_review",
      );
      const responseStatuses = timeline.filter(
        (record) =>
          record.kind === "system_notice" && record.materializationKey === "response_status",
      );

      expect(channelMessages).toHaveLength(3);
      expect(followUpReviews).toHaveLength(1);
      expect(followUpReviews[0]?.data).toMatchObject({
        messageCount: 2,
        messageIds: expect.arrayContaining(["msg-burst-2", "msg-burst-3"]),
      });
      expect(
        responseStatuses.some(
          (record) =>
            record.kind === "system_notice" &&
            record.data?.nextAction === "follow_up" &&
            typeof record.notice === "string",
        ),
      ).toBe(true);
    });

    it("concurrent first receive keeps one cached runtime owner", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-concurrent-owner-"));
      tempDirs.push(tempDir);
      const service = new AgentSessionService(createContextMock(tempDir), {
        model: "test:model",
        basePath: "sessions",
      });
      const bot = createBotMock();

      let releaseFirst!: () => void;
      const firstTurn = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      generateMock.mockImplementationOnce(async () => {
        await firstTurn;
      });
      generateMock.mockResolvedValueOnce();

      const first = service.receive(
        createChannelMessageInput({
          bot,
          channelId: "channel-race",
          isDirect: true,
          messageId: "race-msg-1",
        }),
        bot,
      );
      const second = service.receive(
        createChannelMessageInput({
          bot,
          channelId: "channel-race",
          isDirect: true,
          messageId: "race-msg-2",
        }),
        bot,
      );

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
      });

      expect(service.getActiveChannels()).toEqual(["discord:channel-race"]);

      const runtime = service.getAgent("discord:channel-race");
      expect(runtime).toBeDefined();

      releaseFirst();
      await Promise.all([first, second]);

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(2);
      });

      expect(service.getActiveChannels()).toEqual(["discord:channel-race"]);
      expect(service.getAgent("discord:channel-race")).toBe(runtime);
    });

    it("starts and handles a channel without workspace plugin installed", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-no-plugin-service-"));
      tempDirs.push(tempDir);

      const { ctx } = createCommandContextMock(tempDir, null);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });
      const bot = createBotMock();

      generateMock.mockResolvedValueOnce();

      await startService(service);
      await service.receive(
        createChannelMessageInput({
          bot,
          isDirect: true,
          messageId: "no-plugin-msg-1",
        }),
        bot,
      );

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
      });

      expect(AgentSessionService.inject).toEqual(["yesimbot.model"]);
      const logger = ctx.logger("session") as unknown as ReturnType<typeof createLoggerMock>;
      expect(logger.warn).toHaveBeenCalledWith(
        "[tools:discord:channel-1] PluginService unavailable; continuing with send_message only",
      );
      expect(generateMock.mock.calls[0]?.[0]?.tools).toMatchObject({
        send_message: expect.any(Object),
      });
      expect(service.getActiveChannels()).toEqual(["discord:channel-1"]);
    });

    it("includes skill contributor block when plugin service exposes skill contributors", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-skill-contributor-service-"));
      tempDirs.push(tempDir);
      const ctx = createContextMock(tempDir, {
        getInstructionContributors: () => [
          {
            name: "skill",
            collect: async () => [
              {
                key: "available-skills",
                title: "Available Skills",
                content: "- code-review",
                layer: "extension",
                priority: 60,
              },
            ],
          },
        ],
      });
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });
      const bot = createBotMock();

      generateMock.mockResolvedValueOnce();

      await service.receive(
        createChannelMessageInput({
          bot,
          isDirect: true,
          messageId: "skill-contributor-msg-1",
        }),
        bot,
      );

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
      });

      const systemMessage = (
        generateMock.mock.calls[0]?.[0]?.messages as Array<{ role?: string; content?: unknown }>
      )?.[0];
      expect(systemMessage?.role).toBe("system");
      expect(typeof systemMessage?.content).toBe("string");
      if (typeof systemMessage?.content !== "string") {
        return;
      }

      expect(systemMessage.content).toContain("## Available Skills");
      expect(systemMessage.content).toContain("- code-review");
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
      } as unknown as ChannelRuntime);

      const event = createChannelMessageInput({
        bot,
        platform: "discord",
        channelId: "origin-channel",
        messageId: "route-msg-1",
      });

      await service.receive(event, bot);

      expect(routeSpy).toHaveBeenCalledWith("discord", "origin-channel", bot);
      expect(agentReceive).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "channel_message",
          platform: "discord",
          channelId: "origin-channel",
          messageId: "route-msg-1",
          timestamp: event.timestamp,
          content: event.content,
          sender: {
            userId: event.userId,
            username: event.username,
            nickname: event.nickname,
            identity: event.identity,
          },
          isDirect: event.isDirect,
          atSelf: event.atSelf,
          isReplyToBot: event.isReplyToBot,
        }),
      );
    });

    it("reuses the cached runtime for repeated same-channel receives", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-runtime-reuse-"));
      tempDirs.push(tempDir);
      const service = new AgentSessionService(createContextMock(tempDir), {
        model: "test:model",
        basePath: "sessions",
      });
      const bot = createBotMock();

      const first = createChannelMessageInput({
        bot,
        isDirect: true,
        messageId: "reuse-msg-1",
        timestamp: 1000,
      });
      const second = createChannelMessageInput({
        bot,
        isDirect: true,
        messageId: "reuse-msg-2",
        timestamp: 1001,
      });

      generateMock.mockResolvedValue(undefined);

      await service.receive(first, bot);
      const firstRuntime = service.getAgent("discord:channel-1");
      await service.receive(second, bot);
      const secondRuntime = service.getAgent("discord:channel-1");

      expect(firstRuntime).toBeDefined();
      expect(secondRuntime).toBe(firstRuntime);
      expect(service.getActiveChannels()).toEqual(["discord:channel-1"]);
    });

    it("keeps one restored owner and resumes on the next valid input after restart", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-restart-recovery-"));
      tempDirs.push(tempDir);

      const firstService = new AgentSessionService(createContextMock(tempDir), {
        model: "test:model",
        basePath: "sessions",
      });
      const firstBot = createBotMock();

      generateMock.mockRejectedValueOnce(new Error("model exploded before restart"));

      await firstService.receive(
        createChannelMessageInput({
          bot: firstBot,
          channelId: "channel-restart",
          isDirect: true,
          messageId: "restart-msg-1",
          timestamp: 1000,
          content: "first run fails",
        }),
        firstBot,
      );

      const firstRuntime = firstService.getAgent("discord:channel-restart");
      expect(firstRuntime).toBeDefined();

      await vi.waitFor(() => {
        const timeline = firstRuntime?.sessionManager.getTimeline() ?? [];
        expect(
          timeline.some(
            (record) =>
              record.kind === "system_notice" &&
              record.materializationKey === "response_status" &&
              record.data?.endReason === "exception",
          ),
        ).toBe(true);
      });

      firstRuntime?.sessionManager.appendMessage({
        role: "assistant",
        content: [
          { type: "text", text: "Calling tool before restart" },
          {
            type: "tool-call",
            toolCallId: "restart-tool-call",
            toolName: "send_message",
            args: { content: "ping" },
          },
        ],
        timestamp: 1001,
        provider: "test",
        model: "test:model",
      });

      const restartBot = createBotMock();
      const restartedService = new AgentSessionService(createContextMock(tempDir), {
        model: "test:model",
        basePath: "sessions",
      });

      const bootstrap = await restartedService.bootstrapChannelForManagement(
        "discord",
        "channel-restart",
        restartBot,
      );

      const restoredRuntime = restartedService.getAgent("discord:channel-restart");
      const restoredTimeline = restoredRuntime?.sessionManager.getTimeline() ?? [];

      expect(bootstrap).toMatchObject({
        channelKey: "discord:channel-restart",
        status: "restored",
      });
      expect(restartedService.getActiveChannels()).toEqual(["discord:channel-restart"]);
      expect(restoredRuntime).toBeDefined();
      expect(
        restoredTimeline.some(
          (record) =>
            record.kind === "system_notice" &&
            record.materializationKey === "response_status" &&
            record.data?.endReason === "exception",
        ),
      ).toBe(true);
      expect(
        restoredTimeline.some(
          (record) =>
            record.kind === "tool_message" &&
            record.message.content.some(
              (part) =>
                part.type === "tool-result" &&
                part.toolCallId === "restart-tool-call" &&
                part.output.value === "Session interrupted before tool execution completed",
            ),
        ),
      ).toBe(true);
      expect(
        restoredRuntime?.sessionManager.getModelMessages().some((message) => {
          return typeof message.content === "string" && message.content.includes("response_status");
        }) ?? false,
      ).toBe(false);

      generateMock.mockResolvedValueOnce();

      await restartedService.receive(
        createChannelMessageInput({
          bot: restartBot,
          channelId: "channel-restart",
          isDirect: true,
          messageId: "restart-msg-2",
          timestamp: 1002,
          content: "resume after restart",
        }),
        restartBot,
      );

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(2);
      });

      const resumedRuntime = restartedService.getAgent("discord:channel-restart");
      const resumedTimeline = resumedRuntime?.sessionManager.getTimeline() ?? [];

      expect(restartedService.getActiveChannels()).toEqual(["discord:channel-restart"]);
      expect(resumedRuntime).toBe(restoredRuntime);
      expect(
        resumedTimeline.filter((record) => {
          return (
            record.kind === "channel_message" &&
            record.message.messageId === "restart-msg-2" &&
            record.message.content === "resume after restart"
          );
        }),
      ).toHaveLength(1);
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

      (service as unknown as { agents: Map<string, ChannelRuntime> }).agents.set(
        "discord:channel-1",
        {
          runCompaction,
        } as unknown as ChannelRuntime,
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

      (service as unknown as { agents: Map<string, ChannelRuntime> }).agents.set(
        "discord:channel-1",
        {
          runCompaction,
        } as unknown as ChannelRuntime,
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

    it("bootstraps a channel for compaction without requiring an existing workspace", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-pre-message-compact-"));
      tempDirs.push(tempDir);

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

  describe("agent.clear command", () => {
    it("clears and recreates the runtime without removing a scoped workspace plugin", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-agent-clear-workspace-"));
      tempDirs.push(tempDir);

      const { commands, ctx } = createCommandContextMock(tempDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });

      await startService(service);
      await expect(
        service.bootstrapChannelForManagement("discord", "channel-1", createBotMock()),
      ).resolves.toMatchObject({
        channelKey: "discord:channel-1",
        status: "created",
      });

      const clearAction = commands.get("agent.clear");
      expect(clearAction).toBeDefined();

      await expect(
        clearAction?.({
          options: {
            platform: "discord",
            channel: "channel-1",
          },
        }),
      ).resolves.toBe("Cleared agent session for discord:channel-1.");

      expect(
        (ctx as unknown as { "yesimbot.plugin": { remove: ReturnType<typeof vi.fn> } })[
          "yesimbot.plugin"
        ].remove,
      ).not.toHaveBeenCalled();

      await expect(
        service.bootstrapChannelForManagement("discord", "channel-1", createBotMock()),
      ).resolves.toMatchObject({
        channelKey: "discord:channel-1",
        status: "created",
      });
    });
  });
});
