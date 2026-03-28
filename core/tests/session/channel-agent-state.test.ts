import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChannelAgent } from "../../src/services/session/channel-agent";
import { SessionManager } from "../../src/services/session/session-manager";
import type { ChannelEvent } from "../../src/services/session/types";

type GenerateInput = {
  messages: unknown[];
  abortSignal?: AbortSignal;
};

const generateMock = vi.fn<(input: GenerateInput) => Promise<void>>();
const streamMock =
  vi.fn<
    (
      input: GenerateInput,
      options: Record<string, unknown>,
    ) => Promise<{ consumeStream(): Promise<void> }>
  >();
const toolLoopAgentCtorMock = vi.fn();

vi.mock("ai", () => {
  class ToolLoopAgent {
    readonly options: Record<string, unknown>;
    readonly tools: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      this.tools = (options.tools as Record<string, unknown>) ?? {};
      toolLoopAgentCtorMock(options);
    }

    async generate(input: GenerateInput): Promise<void> {
      return generateMock(input);
    }

    async stream(input: GenerateInput): Promise<{ consumeStream(): Promise<void> }> {
      return streamMock(input, this.options);
    }
  }

  return {
    ToolLoopAgent,
    stepCountIs: (n: number) => n,
  };
});

function createContextMock() {
  return {
    logger: vi.fn(() => ({
      level: 2,
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
    "yesimbot.model": {
      resolve: vi.fn(() => ({ provider: "test", modelId: "test:model" })),
    },
  };
}

function createBotMock(selfId = "bot-self") {
  return {
    selfId,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function createEvent(overrides: Partial<ChannelEvent> = {}): ChannelEvent {
  return {
    platform: "discord",
    channelId: "channel-1",
    userId: "user-1",
    username: "alice",
    content: "@bot hello",
    isDirect: true,
    atSelf: false,
    isReplyToBot: false,
    messageId: `msg-${Math.random().toString(16).slice(2)}`,
    timestamp: Date.now(),
    elements: [],
    ...overrides,
  };
}

function createAgent() {
  const ctx = createContextMock();
  const bot = createBotMock();
  const sessionManager = SessionManager.inMemory("discord:channel-1");
  const agent = new ChannelAgent(ctx as never, {
    bot: bot as never,
    sessionManager,
    platform: "discord",
    channelId: "channel-1",
    modelId: "test:model",
    basePath: "/tmp/athena-test",
    instructions: "test instructions",
    enableWorkspace: false,
  });

  return { agent, sessionManager, bot };
}

describe("ChannelAgent state machine", () => {
  beforeEach(() => {
    generateMock.mockReset();
    streamMock.mockReset();
    toolLoopAgentCtorMock.mockClear();
  });

  describe("state transitions", () => {
    it("transitions idle -> responding -> ended on normal finish", async () => {
      const { agent } = createAgent();
      generateMock.mockResolvedValueOnce();

      await agent.receive(createEvent());

      await vi.waitFor(() => {
        expect(agent.getResponseState()).toBe("idle");
      });
    });

    it("consumes streaming results before completing response", async () => {
      const { bot, sessionManager } = createAgent();

      streamMock.mockImplementationOnce(async (_input, options) => ({
        consumeStream: async () => {
          const onStepFinish = options.onStepFinish as
            | ((stepResult: Record<string, unknown>) => void | Promise<void>)
            | undefined;
          await onStepFinish?.({
            text: "<message>streamed hello</message>",
            model: { provider: "test", modelId: "test:model" },
            usage: { inputTokens: 1, outputTokens: 1 },
            finishReason: "stop",
            response: {
              messages: [{ role: "assistant", content: "<message>streamed hello</message>" }],
            },
          });
        },
      }));

      const streamingAgent = new ChannelAgent(createContextMock() as never, {
        bot: bot as never,
        sessionManager,
        platform: "discord",
        channelId: "channel-1",
        modelId: "test:model",
        basePath: "/tmp/athena-test",
        instructions: "test instructions",
        enableWorkspace: false,
        streaming: true,
      });

      await streamingAgent.receive(createEvent({ messageId: "msg-streaming" }));

      await vi.waitFor(() => {
        expect(bot.sendMessage).toHaveBeenCalledWith("channel-1", "streamed hello");
        expect(streamMock).toHaveBeenCalledTimes(1);
        expect(streamingAgent.getResponseState()).toBe("idle");
      });

      expect(
        sessionManager
          .getEntries()
          .some((entry) => entry.type === "message" && entry.message.role === "assistant"),
      ).toBe(true);
    });

    it.todo("transitions idle -> responding -> aborting -> ended on abort");
    it.todo("transitions idle -> responding -> ended on timeout");
    it.todo("transitions idle -> responding -> ended on error");
  });

  describe("terminal state", () => {
    it.todo("every run reaches terminal state");
  });

  describe("continues after abort", () => {
    it.todo("reuses session after abort");
    it.todo("reuses session after timeout");
  });

  describe("never deadlocks", () => {
    it.todo("returns to idle after error in generate");
    it.todo("returns to idle after abort signal");
    it.todo("watchdog timer forces idle on stuck response");
  });

  describe("single-flight per channel", () => {
    it("queues second trigger while responding", async () => {
      const { agent } = createAgent();
      let releaseFirst!: () => void;
      const firstCall = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      generateMock
        .mockImplementationOnce(async () => {
          await firstCall;
        })
        .mockResolvedValueOnce();

      const firstReceive = agent.receive(createEvent({ messageId: "msg-queue-1" }));
      await Promise.resolve();
      const secondReceive = agent.receive(createEvent({ messageId: "msg-queue-2" }));

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
      });

      releaseFirst();
      await firstReceive;
      await secondReceive;

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(2);
      });
    });

    it.todo("processes queued trigger after first completes");
  });

  describe("serializes concurrent messages", () => {
    it.todo("concurrent receive calls do not interleave responses");
  });

  describe("tool timeout", () => {
    it.todo("tool execution aborts after timeout");
  });

  describe("step cap", () => {
    it.todo("stops after maxSteps reached");
  });

  describe("tool failure ends run", () => {
    it("tool exception still reaches terminal state", async () => {
      const { agent, sessionManager } = createAgent();
      generateMock.mockRejectedValueOnce(new Error("tool exploded"));

      await agent.receive(createEvent({ messageId: "msg-tool-error" }));

      await vi.waitFor(() => {
        expect(agent.getResponseState()).toBe("idle");
      });
      const responseEnd = sessionManager
        .getEntries()
        .find((entry) => entry.type === "custom" && entry.customType === "response_end");
      expect(responseEnd).toBeTruthy();
      if (responseEnd && responseEnd.type === "custom") {
        expect(responseEnd.data).toMatchObject({ endReason: "error" });
      }
    });
  });
});
