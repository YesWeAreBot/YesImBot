import type { LanguageModel } from "ai";
import type { Bot, Context, Logger, Session } from "koishi";
import { describe, expect, it, vi } from "vitest";

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

import { AgentSession } from "../../src/services/session/agent-session";
import { Activation } from "../../src/services/session/domain/activation";
import { serializeSessionMessagesForCompaction } from "../../src/services/session/compaction/serialize";
import { ChannelRuntime } from "../../src/services/session/runtime";
import { ResponseStepProcessor } from "../../src/services/session/runtime/response-step-processor";
import { buildRuntimeModelMessages } from "../../src/services/session/runtime/response-step-processor";
import {
  AgentSessionService,
  koishiSessionToChannelInput,
} from "../../src/services/session/service";
import { SessionManager } from "../../src/services/session/session-manager";
import type { ChannelInput, ChannelMessageInput } from "../../src/services/session/types/index";
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

function createContextMock(baseDir = "/tmp/athena-channel-input"): Context {
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
        model: {} as unknown as LanguageModel,
      })),
      resolve: vi.fn(() => ({}) as unknown as LanguageModel),
    },
    "yesimbot.plugin": {
      getToolSet: vi.fn(() => ({})),
    },
  } as unknown as Context;
}

function createBotMock(selfId = "bot-self"): Bot {
  return {
    selfId,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Bot;
}

function createChannelMessageInput(
  overrides: Partial<ChannelMessageInput> = {},
): ChannelMessageInput {
  return {
    kind: "channel_message",
    platform: "discord",
    channelId: "channel-1",
    messageId: "msg-1",
    timestamp: 1_710_000_000_000,
    content: "hello canonical world",
    sender: {
      userId: "user-1",
      username: "alice",
      nickname: "Alice",
      identity: "member",
    },
    isDirect: true,
    atSelf: false,
    isReplyToBot: false,
    ...overrides,
  };
}

describe("typed runtime input wiring", () => {
  it("normalizes Koishi session into channel input before scheduling", () => {
    const bot = createBotMock();
    const session = {
      platform: "discord",
      channelId: "channel-1",
      userId: "user-1",
      username: "alice",
      content: "hello canonical world",
      isDirect: true,
      messageId: "msg-1",
      timestamp: 1_710_000_000_000,
      bot,
      elements: [{ type: "text", attrs: {} }],
      stripped: { atSelf: false },
      author: {
        nick: "Alice",
        roles: [{ name: "member" }],
        user: { isBot: false },
      },
    } as unknown as Session;

    const input = koishiSessionToChannelInput(session);

    expect(input).toMatchObject({
      kind: "channel_message",
      platform: "discord",
      channelId: "channel-1",
      messageId: "msg-1",
      content: "hello canonical world",
      sender: {
        userId: "user-1",
        username: "alice",
        nickname: "Alice",
      },
      isDirect: true,
    });
    expect(input).not.toHaveProperty("bot");
    expect(input).not.toHaveProperty("session");
    expect(input).not.toHaveProperty("elements");
  });

  it("appends typed user.message entries instead of athena_event timeline records", async () => {
    const ctx = createContextMock();
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const runtime = new ChannelRuntime(ctx, {
      bot: createBotMock(),
      sessionManager,
      settingsManager: createTestSettingsManager(),
      willingnessJudge: {
        judge: vi.fn().mockResolvedValue({ shouldRespond: false, reason: "no_trigger" }),
      },
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-channel-input",
    });

    const event = createChannelMessageInput({ isDirect: false, atSelf: false, isReplyToBot: false });
    const batch = {
      batchId: "batch-runtime-append-1",
      channelKey: "discord:channel-1",
      events: [
        {
          kind: "message",
          id: "evt-runtime-append-1",
          timestamp: event.timestamp,
          platform: event.platform,
          channelId: event.channelId,
          messageId: event.messageId,
          content: event.content,
          sender: event.sender,
          isDirect: event.isDirect,
          atSelf: event.atSelf,
          isReplyToBot: event.isReplyToBot,
        },
      ],
    } as const;

    runtime.session.appendAthenaMessage({
      type: "user.message",
      timestamp: new Date(batch.events[0].timestamp).toISOString(),
      data: {
        messageId: batch.events[0].messageId,
        senderId: batch.events[0].sender.userId,
        senderName: batch.events[0].sender.nickname ?? batch.events[0].sender.username,
        content: batch.events[0].content,
      },
    });
    await runtime.wake({
      ...batch,
      activation: Activation.evaluate(batch),
    });

    const entries = sessionManager.getEntries();
    expect(entries[0]).toMatchObject({
      type: "message",
      message: {
        type: "user.message",
        data: {
          content: "hello canonical world",
        },
      },
    });
    expect(sessionManager.getModelMessages()[0]).toMatchObject({
      role: "user",
      content: expect.stringContaining("hello canonical world"),
    });
  });

  it("runtime response_status and follow_up session_info persist as helper entries and stay out of model messages", () => {
    const ctx = createContextMock();
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const runtime = new ChannelRuntime(ctx, {
      bot: createBotMock(),
      sessionManager,
      settingsManager: createTestSettingsManager(),
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-channel-input",
    });

    runtime.session.appendAthenaMessage({
      type: "user.message",
      timestamp: new Date(1_710_000_000_000).toISOString(),
      data: {
        messageId: "msg-helper-boundary-1",
        senderId: "user-1",
        senderName: "alice",
        content: "hello helper boundary",
      },
    });

    runtime.session.appendStateChange({
      id: "follow-up-review-1",
      timestamp: 1_710_000_000_001,
      stage: "runtime",
      visibility: "internal",
      materialization: "internal",
      stateType: "follow_up_review",
      data: { messageCount: 1 },
    });
    (runtime as unknown as { appendResponseStatus(record: { endReason: "normal"; nextAction: "follow_up"; durationMs: number; stepsCompleted: number }): void }).appendResponseStatus({
      endReason: "normal",
      nextAction: "follow_up",
      durationMs: 10,
      stepsCompleted: 1,
    });

    const entries = sessionManager.getEntries();
    expect(entries.some((entry) => entry.type === "response_status")).toBe(true);
    expect(
      entries.some(
        (entry) =>
          entry.type === "session_info" && entry.provider === "runtime" && entry.modelId === "follow_up_review",
      ),
    ).toBe(true);

    const modelMessages = sessionManager.getModelMessages();
    expect(modelMessages.some((message) => {
      if (typeof message.content !== "string") {
        return false;
      }
      return message.content.includes("response_status") || message.content.includes("follow_up_review");
    })).toBe(false);
  });

  it("routes typed channel_message inputs through service without re-normalizing", async () => {
    const ctx = createContextMock();
    const service = new AgentSessionService(ctx, {
      model: "test:model",
      basePath: "sessions",
    });
    const runtime = new ChannelRuntime(ctx, {
      bot: createBotMock(),
      sessionManager: SessionManager.inMemory("discord:channel-1"),
      settingsManager: createTestSettingsManager(),
      willingnessJudge: {
        judge: vi.fn().mockResolvedValue({ shouldRespond: false, reason: "no_trigger" }),
      },
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-channel-input",
    });
    const wakeSpy = vi.spyOn(runtime, "wake").mockResolvedValue(undefined);
    const getOrCreateAgentSpy = vi.spyOn(service, "getOrCreateAgent").mockResolvedValue(runtime);

    const channelMessageInput: ChannelMessageInput = {
      kind: "channel_message",
      platform: "discord",
      channelId: "channel-1",
      messageId: "msg-1",
      timestamp: Date.now(),
      content: "typed service input",
      sender: {
        userId: "user-2",
        username: "bob",
      },
      isDirect: false,
      atSelf: false,
      isReplyToBot: false,
    };

    await service.receive(channelMessageInput);

    expect(getOrCreateAgentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "message",
        platform: "discord",
        channelId: "channel-1",
        messageId: "msg-1",
      }),
      undefined,
    );
    expect(wakeSpy).not.toHaveBeenCalled();
  });

  it("rejects non-message channel inputs at the runtime seam with typed kind branching", async () => {
    const ctx = createContextMock();
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const runtime = new ChannelRuntime(ctx, {
      bot: createBotMock(),
      sessionManager,
      settingsManager: createTestSettingsManager(),
      willingnessJudge: {
        judge: vi.fn().mockResolvedValue({ shouldRespond: false, reason: "no_trigger" }),
      },
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-channel-input",
    });

    const input: ChannelInput = {
      kind: "channel_event",
      platform: "discord",
      channelId: "channel-1",
      eventId: "evt-1",
      eventType: "member_joined",
      timestamp: Date.now(),
      sourceUserId: "user-2",
    };

    await expect(runtime.receive(input)).rejects.toThrow(
      "Unsupported channel input kind for runtime receive: channel_event",
    );
  });

  it("accepts an already-activated batch through wake instead of assembling raw ingress families", async () => {
    const ctx = createContextMock();
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const runtime = new ChannelRuntime(ctx, {
      bot: createBotMock(),
      sessionManager,
      settingsManager: createTestSettingsManager(),
      willingnessJudge: {
        judge: vi.fn().mockResolvedValue({ shouldRespond: false, reason: "no_trigger" }),
      },
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-channel-input",
    });

    const activatedBatch = {
      batchId: "batch-activated-1",
      channelKey: "discord:channel-1",
      events: [
        {
          kind: "message",
          id: "evt-message-1",
          timestamp: 1_710_000_000_000,
          platform: "discord",
          channelId: "channel-1",
          messageId: "msg-1",
          content: "hello canonical world",
          sender: {
            userId: "user-1",
            username: "alice",
          },
          isDirect: false,
          atSelf: true,
          isReplyToBot: false,
        },
        {
          kind: "internal_signal",
          id: "evt-signal-1",
          timestamp: 1_710_000_000_001,
          platform: "discord",
          channelId: "channel-1",
          signalType: "follow_up_review",
          source: "scheduler",
          summary: "wake runtime",
        },
      ],
      activation: {
        batchId: "batch-activated-1",
        activated: true,
        reasons: [
          { source: "policy", code: "at_self" },
          { source: "event", code: "internal_signal", detail: "follow_up_review" },
        ],
      },
    };

    await expect(
      (runtime as unknown as { wake(batch: typeof activatedBatch): Promise<void> }).wake(activatedBatch),
    ).resolves.toBeUndefined();
  });

  it("merges activated follow-up batches instead of overwriting earlier trigger events", async () => {
    const ctx = createContextMock();
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const runtime = new ChannelRuntime(ctx, {
      bot: createBotMock(),
      sessionManager,
      settingsManager: createTestSettingsManager(),
      willingnessJudge: {
        judge: vi.fn().mockResolvedValue({ shouldRespond: false, reason: "no_trigger" }),
      },
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-channel-input",
    });

    (runtime as unknown as { responseState: string }).responseState = "responding";

    await runtime.wake({
      batchId: "batch-follow-up-1",
      channelKey: "discord:channel-1",
      events: [
        {
          kind: "internal_signal",
          id: "evt-signal-queue-1",
          timestamp: 1_710_000_000_010,
          platform: "discord",
          channelId: "channel-1",
          signalType: "follow_up_review",
          source: "scheduler",
        },
      ],
      activation: {
        batchId: "batch-follow-up-1",
        activated: true,
        reasons: [{ source: "event", code: "internal_signal", detail: "follow_up_review" }],
      },
    });
    await runtime.wake({
      batchId: "batch-follow-up-2",
      channelKey: "discord:channel-1",
      events: [
        {
          kind: "message",
          id: "evt-message-queue-2",
          timestamp: 1_710_000_000_011,
          platform: "discord",
          channelId: "channel-1",
          messageId: "msg-queue-2",
          content: "follow-up hello",
          sender: {
            userId: "user-2",
            username: "bob",
          },
          isDirect: false,
          atSelf: true,
          isReplyToBot: false,
        },
      ],
      activation: {
        batchId: "batch-follow-up-2",
        activated: true,
        reasons: [{ source: "policy", code: "at_self" }],
      },
    });

    const hostInput = (runtime as unknown as {
      buildResponseHostInput(): { triggerEvents: Array<{ id: string; kind: string }> };
    }).buildResponseHostInput();

    expect(hostInput.triggerEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "evt-signal-queue-1", kind: "internal_signal" }),
        expect.objectContaining({ id: "evt-message-queue-2", kind: "message" }),
      ]),
    );
    expect(hostInput.triggerEvents).toHaveLength(2);
  });

  it("rejects raw non-batch athena ingress at runtime once activated batch wake seam exists", async () => {
    const ctx = createContextMock();
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const runtime = new ChannelRuntime(ctx, {
      bot: createBotMock(),
      sessionManager,
      settingsManager: createTestSettingsManager(),
      willingnessJudge: {
        judge: vi.fn().mockResolvedValue({ shouldRespond: false, reason: "no_trigger" }),
      },
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-channel-input",
    });

    await expect(
      runtime.receive(createChannelMessageInput()),
    ).rejects.toThrow("Use AgentSessionService.ingestEvent() for raw ingress; runtime expects activated batches");
  });

  it("aligns assistant/tool role alignment to typed first-class records", () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const processor = new ResponseStepProcessor({
      session: new AgentSession(sessionManager),
      platform: "discord",
      channelId: "channel-1",
      logger: createLoggerMock(),
    });

    processor.beginResponse(false);
    processor.apply({
      stepNumber: 1,
      finishReason: "stop",
      model: { provider: "test", modelId: "test:model" },
      response: {
        messages: [
          {
            role: "assistant",
            content: [
              { type: "tool-call", toolCallId: "call-1", toolName: "lookup", input: { q: 1 } },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "lookup",
                output: { type: "json", value: { ok: true } },
              },
            ],
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    } as never);

    expect(sessionManager.getTimeline()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "assistant_message" }),
        expect.objectContaining({ kind: "tool_message" }),
      ]),
    );
  });

  it("materializes typed records into model messages for runtime context", () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const session = new AgentSession(sessionManager);

    session.appendChannelMessage({
      id: "msg-runtime-1",
      timestamp: 1_710_000_000_000,
      stage: "ingress",
      visibility: "model",
      materialization: "default",
      message: createChannelMessageInput({ messageId: "msg-runtime-1" }),
    });
    session.appendSystemNotice({
      id: "notice-hidden-1",
      timestamp: 1_710_000_000_001,
      stage: "runtime",
      visibility: "hidden",
      materialization: "hidden",
      subType: "protocol_guidance",
      materializationKey: "hidden",
      notice: "should stay hidden",
    });

    expect(buildRuntimeModelMessages(session, "System prompt")).toEqual([
      { role: "system", content: "System prompt" },
      expect.objectContaining({ role: "user" }),
      expect.objectContaining({ role: "user", content: expect.stringContaining("should stay hidden") }),
    ]);
  });

  it("serializes compaction input from SessionMessage history and excludes helper entries", () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const session = new AgentSession(sessionManager);

    session.appendAthenaMessage({
      type: "user.message",
      timestamp: new Date(1_710_000_000_000).toISOString(),
      data: {
        messageId: "msg-compaction-1",
        senderId: "user-1",
        senderName: "Alice",
        content: "hello canonical world",
      },
    });
    session.appendResponseStatus({
      endReason: "normal",
      nextAction: "idle",
      stepsCompleted: 1,
      durationMs: 12,
    });
    session.appendSessionInfo("runtime", "follow_up_review");

    const serialized = serializeSessionMessagesForCompaction(session.getSessionMessages());

    expect(serialized).toContain("hello canonical world");
    expect(serialized).not.toContain("response_status");
    expect(serialized).not.toContain("follow_up_review");
  });
});
