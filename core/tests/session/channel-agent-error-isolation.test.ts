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

import { AgentSession } from "../../src/services/session/agent-session";
import {
  buildGenerateInputForTest,
  ChannelRuntime,
  createAgentAssistantMessage,
  normalizeAssistantContent,
} from "../../src/services/session/runtime";
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
  const loggerFactory = Object.assign(
    vi.fn(() => logger),
    logger,
  );
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

function createSession(): AgentSession {
  const sessionManager = SessionManager.inMemory("discord:channel-1");
  return new AgentSession(sessionManager);
}

describe("ChannelRuntime plugin safety helpers", () => {
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

  it("builds generation payload with system instruction boundary", () => {
    const session = createSession();

    const { messages } = buildGenerateInputForTest({
      instructions: "test-instruction",
      session,
    });

    expect(messages[0]).toEqual({ role: "system", content: "test-instruction" });
  });

  it("rejects legacy sessionEntries rebuild inputs", () => {
    const legacyInput = {
      instructions: "test-instruction",
      ["sessionEntries"]: [],
    };

    expect(() =>
      buildGenerateInputForTest(legacyInput as never),
    ).toThrow();
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
    const agent = new ChannelRuntime(ctx as never, {
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
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("discord:channel-1"));
    });
  });
});
