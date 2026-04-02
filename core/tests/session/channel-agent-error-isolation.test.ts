import { beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  buildGenerateInputForTest,
  ChannelAgent,
  createAgentAssistantMessage,
  normalizeAssistantContent,
} from "../../src/services/session/channel-agent";
import { TurnFinalizer } from "../../src/services/session/channel-agent/finalization/turn-finalizer";
import { SessionManager } from "../../src/services/session/session-manager";
import type { ChannelEvent, ResponseEndRecord } from "../../src/services/session/types";
import { createTestSettingsManager } from "./test-settings-manager";

function createContextMock() {
  const logger = {
    level: 2,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const loggerFactory = Object.assign(vi.fn(() => logger), logger);
  return {
    ctx: {
      logger: loggerFactory,
      "yesimbot.model": {
        resolve: vi.fn(() => ({ provider: "test", modelId: "test:model" })),
      },
    },
    logger,
  };
}

function createBotMock() {
  return {
    selfId: "bot-self",
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function createEvent(overrides: Partial<ChannelEvent> = {}): ChannelEvent {
  return {
    platform: "discord",
    channelId: "channel-1",
    userId: "user-1",
    username: "alice",
    content: "hello",
    isDirect: true,
    atSelf: false,
    isReplyToBot: false,
    messageId: "msg-error-1",
    timestamp: Date.now(),
    elements: [],
    ...overrides,
  };
}

describe("ChannelAgent plugin safety helpers", () => {
  beforeEach(() => {
    generateMock.mockReset();
  });

  it("normalizes assistant tool-call parts for persistence", () => {
    const content = normalizeAssistantContent([
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "write_file",
        input: { path: "../outside.txt" },
      },
    ]);

    expect(content).toEqual([
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "write_file",
        args: { path: "../outside.txt" },
      },
    ]);
  });

  it("keeps response_end exception shape stable for persistence", () => {
    const record: ResponseEndRecord = {
      endReason: "exception",
      nextOutcome: "blocked",
      durationMs: 1200,
      stepsCompleted: 2,
      error: "plugin execution failed",
    };

    expect(record).toMatchObject({
      endReason: "exception",
      stepsCompleted: 2,
      error: expect.stringContaining("plugin"),
    });
  });

  it("all six exact reason strings resolve from finalizer matrix", () => {
    const finalizer = new TurnFinalizer();

    expect(
      finalizer.resolveEndReason({
        aborted: false,
        timedOut: false,
        protocolError: false,
        heartbeatRequested: false,
        sendFailure: false,
      }),
    ).toBe("normal");
    expect(
      finalizer.resolveEndReason({
        aborted: false,
        timedOut: false,
        protocolError: false,
        heartbeatRequested: true,
        sendFailure: false,
      }),
    ).toBe("heartbeat_continuation");
    expect(
      finalizer.resolveEndReason({
        aborted: false,
        timedOut: false,
        protocolError: true,
        heartbeatRequested: true,
        sendFailure: false,
      }),
    ).toBe("protocol_error");
    expect(
      finalizer.resolveEndReason({
        aborted: false,
        timedOut: true,
        protocolError: false,
        heartbeatRequested: true,
        sendFailure: true,
      }),
    ).toBe("timeout");
    expect(
      finalizer.resolveEndReason({
        aborted: true,
        timedOut: false,
        protocolError: false,
        heartbeatRequested: true,
        sendFailure: true,
      }),
    ).toBe("abort");
    expect(
      finalizer.resolveEndReason({
        aborted: false,
        timedOut: false,
        protocolError: false,
        heartbeatRequested: false,
        sendFailure: true,
        thrownError: "transport failed",
      }),
    ).toBe("exception");
  });

  it("builds generation payload with system instruction boundary", () => {
    const { messages } = buildGenerateInputForTest({
      instructions: "test-instruction",
      sessionEntries: [],
    });

    expect(messages[0]).toEqual({ role: "system", content: "test-instruction" });
  });

  it("preserves finish reason in assistant payload", () => {
    const assistant = createAgentAssistantMessage({
      content: "done",
      finishReason: "error",
    });

    expect(assistant.finishReason).toBe("error");
  });

  it("logs response failures with the channel identifier", async () => {
    const { ctx, logger } = createContextMock();
    const agent = new ChannelAgent(ctx as never, {
      bot: createBotMock() as never,
      sessionManager: SessionManager.inMemory("discord:channel-1"),
      settingsManager: createTestSettingsManager(),
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-test",
    });

    generateMock.mockRejectedValueOnce(new Error("transport failed"));

    await agent.receive(createEvent());

    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("discord:channel-1"),
      );
    });
  });
});
