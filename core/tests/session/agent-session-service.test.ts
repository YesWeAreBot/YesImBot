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

import { ChannelRuntime } from "../../src/services/session/runtime";
import { AgentSessionService } from "../../src/services/session/service";
import { SessionManager } from "../../src/services/session/session-manager";
import type { ChannelEvent } from "../../src/services/session/types";
import type { WillingnessJudge } from "../../src/services/session/willingness";
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
  writeFileSync(
    join(globalRoot, "settings.json"),
    JSON.stringify({ model: "test:model" }, null, 2),
  );
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(join(channelDir, "settings.json"), JSON.stringify({ useGlobal: true }, null, 2));
}

describe("AgentSessionService", () => {
  describe("event ingress", () => {
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

      await agent.receive(createEvent({ bot }));

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
      await agent.receive(createEvent({ bot, isDirect: true, atSelf: false, isReplyToBot: false }));

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
        createEvent({ bot, isDirect: false, atSelf: false, isReplyToBot: false }),
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
      } as unknown as ChannelRuntime);

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

      let releaseFirst!: () => void;
      const firstTurn = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      generateMock.mockImplementationOnce(async () => {
        await firstTurn;
      });
      generateMock.mockResolvedValueOnce();

      const first = service.receive(
        createEvent({ channelId: "channel-race", isDirect: true, messageId: "race-msg-1" }),
      );
      const second = service.receive(
        createEvent({ channelId: "channel-race", isDirect: true, messageId: "race-msg-2" }),
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

      const event = createEvent({
        bot,
        platform: "discord",
        channelId: "origin-channel",
        messageId: "route-msg-1",
      });

      await service.receive(event);

      expect(routeSpy).toHaveBeenCalledWith("discord", "origin-channel", bot);
      expect(agentReceive).toHaveBeenCalledWith({
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
        replyTo: event.replyTo,
      });
    });

    it("reuses the cached runtime for repeated same-channel receives", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-runtime-reuse-"));
      tempDirs.push(tempDir);
      const service = new AgentSessionService(createContextMock(tempDir), {
        model: "test:model",
        basePath: "sessions",
      });
      const bot = createBotMock();

      const first = createEvent({ bot, isDirect: true, messageId: "reuse-msg-1", timestamp: 1000 });
      const second = createEvent({
        bot,
        isDirect: true,
        messageId: "reuse-msg-2",
        timestamp: 1001,
      });

      generateMock.mockResolvedValue(undefined);

      await service.receive(first);
      const firstRuntime = service.getAgent("discord:channel-1");
      await service.receive(second);
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

      generateMock.mockRejectedValueOnce(new Error("model exploded before restart"));

      await firstService.receive(
        createEvent({
          channelId: "channel-restart",
          isDirect: true,
          messageId: "restart-msg-1",
          timestamp: 1000,
          content: "first run fails",
        }),
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
        createEvent({
          bot: restartBot,
          channelId: "channel-restart",
          isDirect: true,
          messageId: "restart-msg-2",
          timestamp: 1002,
          content: "resume after restart",
        }),
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
