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
import { serializeTimelineForCompaction } from "../../src/services/session/compaction/serialize";
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

  it("appends typed channel records instead of formatted channel_message text", async () => {
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

    await runtime.receive(
      createChannelMessageInput({ isDirect: false, atSelf: false, isReplyToBot: false }),
    );

    const timeline = sessionManager.getTimeline();
    expect(timeline[0]).toMatchObject({
      kind: "channel_message",
      message: {
        kind: "channel_message",
        content: "hello canonical world",
      },
    });
    expect(timeline[0]).not.toMatchObject({
      message: {
        content: expect.stringContaining("[timestamp]"),
      },
    });
  });

  it("routes typed channel_message inputs through service without re-normalizing", async () => {
    const ctx = createContextMock();
    const service = new AgentSessionService(ctx, {
      model: "test:model",
      basePath: "sessions",
    });
    const agentReceive = vi.fn().mockResolvedValue(undefined);
    const getOrCreateAgentSpy = vi.spyOn(service, "getOrCreateAgent").mockReturnValue({
      receive: agentReceive,
    } as unknown as ChannelRuntime);

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

    expect(getOrCreateAgentSpy).toHaveBeenCalledWith(channelMessageInput, undefined);
    expect(agentReceive).toHaveBeenCalledWith(channelMessageInput);
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
    ]);
  });

  it("respects SystemNotice subtype visibility during compaction serialization", () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const session = new AgentSession(sessionManager);

    session.appendChannelMessage({
      id: "msg-compaction-1",
      timestamp: 1_710_000_000_000,
      stage: "ingress",
      visibility: "model",
      materialization: "default",
      message: createChannelMessageInput({ messageId: "msg-compaction-1" }),
    });
    session.appendSystemNotice({
      id: "notice-hidden-2",
      timestamp: 1_710_000_000_001,
      stage: "runtime",
      visibility: "hidden",
      materialization: "hidden",
      subType: "protocol_guidance",
      materializationKey: "hidden",
      notice: "do not leak this",
    });
    session.appendSystemNotice({
      id: "notice-visible-1",
      timestamp: 1_710_000_000_002,
      stage: "runtime",
      visibility: "internal",
      materialization: "subtype",
      subType: "compaction_summary",
      materializationKey: "summary",
      notice: "keep this visible",
    });

    const serialized = serializeTimelineForCompaction(session.getTimeline(), {
      systemNoticeStrategies: {
        compaction_summary: () => [{ role: "system", content: "[notice] keep this visible" }],
      },
    });

    expect(serialized).toContain("hello canonical world");
    expect(serialized).toContain("keep this visible");
    expect(serialized).not.toContain("do not leak this");
  });
});
