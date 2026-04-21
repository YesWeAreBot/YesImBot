import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

import {
  getChannelMetaPath,
  getChannelStateDir,
  getUserMetaPath,
  getUserStateDir,
} from "../../src/services/session/instruction-state/layout";
import { ChannelRuntime } from "../../src/services/session/runtime";
import { AgentSessionService } from "../../src/services/session/service";
import { SessionManager } from "../../src/services/session/session-manager";
import type { AthenaEvent } from "../../src/services/session/types";
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
  compileTools?: () => Promise<{
    tools: Record<string, unknown>;
    handles: Record<string, unknown>;
    signature: string;
  }>;
  buildContext?: (request: {
    runtime?: unknown;
    scope?: string;
    hostInput?: unknown;
    catalog?: unknown;
  }) => Promise<Record<string, unknown>>;
  selectTools?: (request: {
    runtime?: unknown;
    scope?: string;
    catalog: { tools: Record<string, unknown> };
    responseContext: Record<string, unknown>;
    builtinTools?: Record<string, unknown>;
  }) => Promise<{
    activeTools: Record<string, unknown>;
    activeToolNames: string[];
    responseContext: Record<string, unknown>;
  }>;
  getToolDefinitions?: () => unknown[];
  getInstructions?: () => unknown[];
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
          (async () => ({
            tools: {},
            handles: {},
            signature: "[]",
          })),
      ),
      buildContext: vi.fn(pluginOptions.buildContext ?? (async () => ({}))),
      selectTools: vi.fn(
        pluginOptions.selectTools ??
          (async (request: {
            runtime?: unknown;
            scope?: string;
            catalog: { tools: Record<string, unknown> };
            responseContext: Record<string, unknown>;
            builtinTools?: Record<string, unknown>;
          }) => {
            const activeTools = { ...(request.builtinTools ?? {}), ...request.catalog.tools };

            return {
              activeTools,
              activeToolNames: Object.keys(activeTools),
              responseContext: request.responseContext,
            };
          }),
      ),
      getToolDefinitions: vi.fn(pluginOptions.getToolDefinitions ?? (() => [])),
      getInstructions: vi.fn(pluginOptions.getInstructions ?? (() => [])),
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

function createMessageAthenaEvent(
  overrides: Partial<Extract<AthenaEvent, { kind: "message" }>> = {},
): Extract<AthenaEvent, { kind: "message" }> {
  return {
    kind: "message",
    id: "athena-message-1",
    timestamp: 1_710_000_000_000,
    platform: "discord",
    channelId: "channel-1",
    messageId: "msg-athena-1",
    content: "hello athena",
    sender: {
      userId: "user-1",
      username: "alice",
    },
    isDirect: false,
    atSelf: true,
    isReplyToBot: false,
    ...overrides,
  };
}

function createInternalSignalAthenaEvent(
  overrides: Partial<Extract<AthenaEvent, { kind: "internal_signal" }>> = {},
): Extract<AthenaEvent, { kind: "internal_signal" }> {
  return {
    kind: "internal_signal",
    id: "athena-signal-1",
    timestamp: 1_710_000_000_001,
    platform: "discord",
    channelId: "channel-1",
    signalType: "follow_up_review",
    source: "scheduler",
    summary: "wake runtime",
    ...overrides,
  };
}

type AgentSessionServiceWithIngress = AgentSessionService & {
  ingestEvent(event: AthenaEvent, bot?: Bot): Promise<void>;
};

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
    it("creates only user-scoped state on the first direct message", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-state-meta-on-message-"));
      tempDirs.push(tempDir);
      const ctx = createContextMock(tempDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });
      const bot = createBotMock();
      const globalRoot = join(tempDir, "sessions");
      const legacyChannelDir = join(globalRoot, "discord-channel-1");

      mkdirSync(legacyChannelDir, { recursive: true });
      writeFileSync(join(legacyChannelDir, "stale.txt"), "legacy", "utf8");

      generateMock.mockResolvedValueOnce();

      await service.receive(
        createChannelMessageInput({
          bot,
          isDirect: true,
          messageId: "state-meta-msg-1",
          sender: {
            userId: "user-42",
            username: "alice",
            nickname: "Alice",
          },
        }),
        bot,
      );

      const channelStateDir = getChannelStateDir(globalRoot, "discord", "channel-1");
      const userStateDir = getUserStateDir(globalRoot, "discord", "user-42");
      const userMeta = JSON.parse(
        readFileSync(getUserMetaPath(globalRoot, "discord", "user-42"), "utf8"),
      );

      expect(existsSync(channelStateDir)).toBe(false);
      expect(existsSync(getChannelMetaPath(globalRoot, "discord", "channel-1"))).toBe(false);
      expect(existsSync(userStateDir)).toBe(true);
      expect(existsSync(join(userStateDir, "session"))).toBe(true);
      expect(existsSync(legacyChannelDir)).toBe(true);
      expect(readFileSync(join(legacyChannelDir, "stale.txt"), "utf8")).toBe("legacy");
      expect(userMeta).toEqual({
        platform: "discord",
        userId: "user-42",
        username: "alice",
        displayName: "Alice",
        kind: "private-user",
      });
    });

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
      expect(systemMessage.content).toContain("Conversation type: group");
      expect(systemMessage.content).toContain("Mentioned bot: no");
      expect(systemMessage.content).toContain("Reply-to-bot: no");
    });

    it("persists before willingness", async () => {
      const ctx = createContextMock("/");
      const bot = createBotMock();
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });
      const sessionManager = SessionManager.inMemory("discord:channel-1");
      const runtime = new ChannelRuntime(ctx, {
        bot,
        sessionManager,
        settingsManager: createTestSettingsManager(),
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-test",
      });
      vi.spyOn(service, "getOrCreateAgent").mockResolvedValue(runtime);

      await service.receive(createChannelMessageInput({ bot, atSelf: false }));

      expect(sessionManager.getEntryCount()).toBeGreaterThan(0);
      expect(bot.sendMessage).not.toHaveBeenCalled();
    });

    it("uses runtime heuristic first and skips deferred judge for direct messages", async () => {
      const ctx = createContextMock("/");
      const bot = createBotMock();
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });
      const sessionManager = SessionManager.inMemory("discord:channel-1");
      const deferredJudge: WillingnessJudge = {
        judge: vi.fn().mockResolvedValue({ shouldRespond: false, reason: "no_trigger" }),
      };
      const runtime = new ChannelRuntime(ctx, {
        bot,
        sessionManager,
        settingsManager: createTestSettingsManager(),
        willingnessJudge: deferredJudge,
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-test",
      });
      vi.spyOn(service, "getOrCreateAgent").mockResolvedValue(runtime);

      generateMock.mockResolvedValueOnce();
      await service.receive(
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
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });
      const sessionManager = SessionManager.inMemory("discord:channel-1");
      const deferredJudge: WillingnessJudge = {
        judge: vi.fn().mockResolvedValue({ shouldRespond: false, reason: "no_trigger" }),
      };
      const runtime = new ChannelRuntime(ctx, {
        bot,
        sessionManager,
        settingsManager: createTestSettingsManager(),
        willingnessJudge: deferredJudge,
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-test",
      });
      vi.spyOn(service, "getOrCreateAgent").mockResolvedValue(runtime);

      await service.receive(
        createChannelMessageInput({ bot, isDirect: false, atSelf: false, isReplyToBot: false }),
      );

      expect(deferredJudge.judge).toHaveBeenCalledTimes(1);
      expect(sessionManager.getEntryCount()).toBeGreaterThan(0);
      expect(generateMock).not.toHaveBeenCalled();
    });

    it("persists projectToAthenaMessage user.message payload with reply summary", async () => {
      const ctx = createContextMock("/");
      const bot = createBotMock();
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });
      const sessionManager = SessionManager.inMemory("discord:channel-1");
      const runtime = new ChannelRuntime(ctx, {
        bot,
        sessionManager,
        settingsManager: createTestSettingsManager(),
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-test",
      });
      vi.spyOn(service, "getOrCreateAgent").mockResolvedValue(runtime);

      await service.receive(
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
        .getEntries()
        .find((entry) => entry.type === "message" && "type" in entry.message);

      expect(persisted).toBeTruthy();
      if (!persisted || persisted.type !== "message" || !("type" in persisted.message)) {
        return;
      }

      expect(persisted.message.type).toBe("user.message");
      expect(persisted.message.data).toMatchObject({
        senderName: "Alice-Display",
      });
      expect(persisted.message.data.replyTo).toMatchObject({
        content: "quoted summary",
      });

      const modelMessage = sessionManager.getModelMessages()[0];
      expect(modelMessage).toMatchObject({ role: "user" });
      expect(modelMessage?.content).toEqual(expect.any(String));
      if (typeof modelMessage?.content !== "string") {
        return;
      }

      expect(modelMessage.content).toContain("hello");
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
      const agent = new ChannelRuntime(ctx, {
        bot: createBotMock(),
        sessionManager: SessionManager.inMemory("discord:channel-1"),
        settingsManager: createTestSettingsManager(),
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-dedupe-test",
      });
      const wakeSpy = vi.spyOn(agent, "wake").mockResolvedValue(undefined);
      vi.spyOn(service, "getOrCreateAgent").mockResolvedValue(agent);

      const event = createChannelMessageInput({ messageId: "dup-msg-1", atSelf: true });
      await service.receive(event);
      await service.receive(event);

      expect(wakeSpy).toHaveBeenCalledTimes(1);
    });

    it("ingestEvent records projected message before activation_result helper and keeps record-only batches asleep", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-ingest-record-only-"));
      tempDirs.push(tempDir);
      const ctx = createContextMock(tempDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      }) as AgentSessionServiceWithIngress;
      const bot = createBotMock();

      await service.ingestEvent(
        createMessageAthenaEvent({
          id: "athena-record-only-1",
          messageId: "athena-record-only-1",
          atSelf: false,
          isDirect: false,
          isReplyToBot: false,
        }),
        bot,
      );

      const runtime = (service as unknown as { agents: Map<string, ChannelRuntime> }).agents.get(
        "discord:channel-1",
      );

      expect(runtime).toBeTruthy();
      if (!runtime) {
        return;
      }

      expect(generateMock).not.toHaveBeenCalled();
      expect(runtime.sessionManager.getEntries()).toEqual([
        expect.objectContaining({
          type: "message",
          message: expect.objectContaining({
            type: "user.message",
            data: expect.objectContaining({
              messageId: "athena-record-only-1",
              content: "hello athena",
            }),
          }),
        }),
        expect.objectContaining({
          type: "activation_result",
          activated: false,
          batchId: expect.any(String),
          reasons: expect.arrayContaining([expect.stringContaining("no_trigger")]),
        }),
      ]);
    });

    it("ingestEvent forms same-channel mixed eventBatch before wake and records both record-only and activated activation_result notices", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-ingest-mixed-batch-"));
      tempDirs.push(tempDir);
      const ctx = createContextMock(tempDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      }) as AgentSessionServiceWithIngress;
      const bot = createBotMock();

      generateMock.mockResolvedValueOnce();

      await service.ingestEvent(
        createMessageAthenaEvent({
          id: "athena-mixed-message-1",
          messageId: "athena-mixed-message-1",
          atSelf: false,
          isDirect: false,
          isReplyToBot: false,
          timestamp: 1_710_000_000_010,
        }),
        bot,
      );
      await service.ingestEvent(
        createInternalSignalAthenaEvent({
          id: "athena-mixed-signal-1",
          timestamp: 1_710_000_000_011,
        }),
        bot,
      );

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
      });

      const runtime = (service as unknown as { agents: Map<string, ChannelRuntime> }).agents.get(
        "discord:channel-1",
      );

      expect(runtime).toBeTruthy();
      if (!runtime) {
        return;
      }

      const activationRecords = runtime.sessionManager
        .getEntries()
        .filter((entry) => entry.type === "activation_result");

      expect(activationRecords).toHaveLength(2);
      expect(activationRecords[0]).toMatchObject({
        activated: false,
        reasons: expect.arrayContaining([expect.stringContaining("no_trigger")]),
      });
      expect(activationRecords[1]).toMatchObject({
        activated: true,
        reasons: expect.arrayContaining([
          expect.stringContaining("no_trigger"),
          expect.stringContaining("internal_signal"),
        ]),
      });
    });

    it("clears handed-off pending batch state even when wake fails", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-wake-failure-cleanup-"));
      tempDirs.push(tempDir);
      const service = new AgentSessionService(createContextMock(tempDir), {
        model: "test:model",
        basePath: "sessions",
      }) as AgentSessionServiceWithIngress;
      const bot = createBotMock();
      const runtime = new ChannelRuntime(createContextMock(tempDir), {
        bot,
        sessionManager: SessionManager.inMemory("discord:channel-1"),
        settingsManager: createTestSettingsManager(),
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-wake-failure-cleanup",
      });
      const wakeSpy = vi
        .spyOn(runtime, "wake")
        .mockRejectedValueOnce(new Error("wake failed"))
        .mockResolvedValueOnce(undefined);
      vi.spyOn(service, "getOrCreateAgent").mockResolvedValue(runtime);

      await expect(
        service.ingestEvent(
          createMessageAthenaEvent({
            id: "wake-cleanup-msg-1",
            messageId: "wake-cleanup-msg-1",
            atSelf: true,
          }),
          bot,
        ),
      ).rejects.toThrow("wake failed");

      expect(
        (service as unknown as { pendingEventBatches: Map<string, unknown> }).pendingEventBatches
          .size,
      ).toBe(0);

      await service.ingestEvent(
        createMessageAthenaEvent({
          id: "wake-cleanup-msg-2",
          messageId: "wake-cleanup-msg-2",
          atSelf: true,
          timestamp: 1_710_000_000_123,
        }),
        bot,
      );

      expect(wakeSpy).toHaveBeenCalledTimes(2);
      expect(wakeSpy.mock.calls[1]?.[0]).toMatchObject({
        batchId: "batch:wake-cleanup-msg-2",
        events: [
          expect.objectContaining({
            id: "wake-cleanup-msg-2",
          }),
        ],
      });
    });

    it("preserves all activated follow-up events while an active turn is running", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-activated-follow-up-queue-"));
      tempDirs.push(tempDir);
      const hostInputs: Array<{
        triggerEvents: Array<{ id: string; kind: string }>;
      }> = [];
      const ctx = createContextMock(tempDir, {
        buildContext: async (request) => {
          hostInputs.push(
            request.hostInput as {
              triggerEvents: Array<{ id: string; kind: string }>;
            },
          );
          return {};
        },
      });
      const service = new AgentSessionService(ctx, {
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
          messageId: "follow-up-root-msg",
          timestamp: 2000,
        }),
        bot,
      );

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
      });

      const second = service.ingestEvent(
        createInternalSignalAthenaEvent({
          id: "follow-up-signal-1",
          timestamp: 2001,
        }),
        bot,
      );
      const third = service.ingestEvent(
        createMessageAthenaEvent({
          id: "follow-up-msg-2",
          messageId: "follow-up-msg-2",
          atSelf: true,
          timestamp: 2002,
        }),
        bot,
      );

      releaseFirst();
      await Promise.all([first, second, third]);

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(2);
        expect(hostInputs).toHaveLength(2);
      });

      expect(hostInputs[1]?.triggerEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "follow-up-signal-1", kind: "internal_signal" }),
          expect.objectContaining({ id: "follow-up-msg-2", kind: "message" }),
        ]),
      );
      expect(Array.from(new Set(hostInputs[1]?.triggerEvents.map((event) => event.id)))).toEqual(
        expect.arrayContaining(["follow-up-signal-1", "follow-up-msg-2"]),
      );
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
      const entries = runtime?.sessionManager.getEntries() ?? [];
      const channelMessages = entries.filter(
        (entry) =>
          entry.type === "message" &&
          "type" in entry.message &&
          entry.message.type === "user.message",
      );
      const followUpReviews = entries.filter(
        (entry) => entry.type === "session_info" && entry.modelId === "follow_up_review",
      );
      const responseStatuses = entries.filter((entry) => entry.type === "response_status");

      expect(channelMessages).toHaveLength(3);
      expect(followUpReviews).toHaveLength(1);
      expect(followUpReviews[0]).toMatchObject({
        infoType: "runtime_state",
        provider: "runtime",
        modelId: "follow_up_review",
        stateType: "follow_up_review",
        data: expect.objectContaining({
          messageCount: 1,
          messageIds: ["msg-burst-3"],
          content: expect.stringContaining("Tracked message IDs: msg-burst-3"),
        }),
      });
      expect(
        responseStatuses.some(
          (record) =>
            record.type === "response_status" &&
            record.nextAction === "follow_up" &&
            typeof record.endReason === "string",
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

      expect(AgentSessionService.inject).toEqual(["yesimbot.model", "yesimbot.plugin"]);
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
        getInstructions: () => [
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
    it("stores direct-message sessions under the encoded user state tree", async () => {
      const baseDir = mkdtempSync(join(tmpdir(), "athena-session-state-"));
      tempDirs.push(baseDir);

      const ctx = createContextMock(baseDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "data/yesimbot/agents",
      });

      generateMock.mockResolvedValueOnce();

      await service.receive(
        createChannelMessageInput({
          channelId: "channel/with:special#chars",
          isDirect: true,
          messageId: "session-path-msg-1",
        }),
      );

      const sessionDir = join(
        baseDir,
        "data/yesimbot/agents/state/users/discord/dXNlci0x",
        "session",
      );

      expect(existsSync(sessionDir)).toBe(true);
      expect(readdirSync(sessionDir).some((name) => name.endsWith(".jsonl"))).toBe(true);
      expect(
        existsSync(
          join(baseDir, "data/yesimbot/agents/discord-channel/with:special#chars/session"),
        ),
      ).toBe(false);
    });

    it("channel-local delivery", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-channel-route-"));
      tempDirs.push(tempDir);
      const ctx = createContextMock(tempDir);
      const service = new AgentSessionService(ctx, {
        model: "test:model",
        basePath: "sessions",
      });
      const bot = createBotMock();
      const agent = new ChannelRuntime(ctx, {
        bot,
        sessionManager: SessionManager.inMemory("discord:origin-channel"),
        settingsManager: createTestSettingsManager(),
        platform: "discord",
        channelId: "origin-channel",
        basePath: "/tmp/athena-channel-route",
      });
      const wakeSpy = vi.spyOn(agent, "wake").mockResolvedValue(undefined);
      const routeSpy = vi.spyOn(service, "getOrCreateAgent").mockResolvedValue(agent);

      const event = createChannelMessageInput({
        bot,
        platform: "discord",
        channelId: "origin-channel",
        messageId: "route-msg-1",
        atSelf: true,
      });

      await service.receive(event, bot);

      expect(routeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "message",
          platform: "discord",
          channelId: "origin-channel",
          messageId: "route-msg-1",
        }),
        bot,
      );
      expect(wakeSpy).toHaveBeenCalledTimes(1);
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
        const entries = firstRuntime?.sessionManager.getEntries() ?? [];
        expect(
          entries.some(
            (record) => record.type === "response_status" && record.endReason === "exception",
          ),
        ).toBe(true);
      });

      firstRuntime?.sessionManager.appendAssistantMessage({
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
      });

      const restartBot = createBotMock();
      const restartedService = new AgentSessionService(createContextMock(tempDir), {
        model: "test:model",
        basePath: "sessions",
      });
      expect(restartedService.getActiveChannels()).toEqual([]);

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
      const resumedEntries = resumedRuntime?.sessionManager.getEntries() ?? [];

      expect(restartedService.getActiveChannels()).toEqual(["discord:channel-restart"]);
      expect(resumedRuntime).toBeDefined();
      expect(
        resumedEntries.some(
          (record) => record.type === "response_status" && record.endReason === "exception",
        ),
      ).toBe(true);
      expect(
        resumedEntries.some(
          (record) =>
            record.type === "message" &&
            !("type" in record.message) &&
            record.message.role === "assistant" &&
            Array.isArray(record.message.content) &&
            record.message.content.some(
              (part) => part.type === "tool-call" && part.toolCallId === "restart-tool-call",
            ),
        ),
      ).toBe(true);
      expect(
        resumedRuntime?.sessionManager.getModelMessages().some((message) => {
          return typeof message.content === "string" && message.content.includes("response_status");
        }) ?? false,
      ).toBe(false);
      expect(
        resumedEntries.filter((record) => {
          return (
            record.type === "message" &&
            "type" in record.message &&
            record.message.type === "user.message" &&
            record.message.data.messageId === "restart-msg-2" &&
            record.message.data.content === "resume after restart"
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

    it("requires an active channel for compaction", async () => {
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
      ).resolves.toBe("No active agent for discord:channel-1.");
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
      generateMock.mockResolvedValueOnce();
      await service.receive(
        createChannelMessageInput({
          bot: createBotMock(),
          isDirect: true,
          atSelf: true,
          isReplyToBot: true,
          messageId: "clear-msg-1",
        }),
        createBotMock(),
      );

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

      generateMock.mockResolvedValueOnce();
      await service.receive(
        createChannelMessageInput({
          bot: createBotMock(),
          isDirect: true,
          atSelf: true,
          isReplyToBot: true,
          messageId: "clear-msg-2",
        }),
        createBotMock(),
      );

      expect(service.getAgent("discord:channel-1")).toBeDefined();
    });
  });
});
