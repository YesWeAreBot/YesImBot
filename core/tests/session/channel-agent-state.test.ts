import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChannelRuntime } from "../../src/services/session/runtime";
import { TurnFinalizer } from "../../src/services/session/runtime/finalization/turn-finalizer";
import { SessionManager } from "../../src/services/session/session-manager";
import type { AthenaSessionSettings } from "../../src/services/session/settings-manager";
import type { ChannelEvent } from "../../src/services/session/types";
import { createTestSettingsManager } from "./test-settings-manager";

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

function createBurstEvents(messageIds: string[]): ChannelEvent[] {
  return messageIds.map((messageId, index) =>
    createEvent({
      isDirect: true,
      messageId,
      timestamp: 1000 + index,
    }),
  );
}

function createAgent() {
  const ctx = createContextMock();
  const bot = createBotMock();
  const sessionManager = SessionManager.inMemory("discord:channel-1");
  const agent = new ChannelRuntime(ctx as never, {
    bot: bot as never,
    sessionManager,
    settingsManager: createTestSettingsManager(),
    platform: "discord",
    channelId: "channel-1",
    basePath: "/tmp/athena-test",
  });

  return { agent, sessionManager, bot };
}

describe("ChannelRuntime state machine", () => {
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
            model: { provider: "test", modelId: "test:model" },
            usage: { inputTokens: 1, outputTokens: 1 },
            finishReason: "tool-calls",
            response: {
              messages: [
                {
                  role: "assistant",
                  content: [
                    {
                      type: "tool-call",
                      toolCallId: "call-stream",
                      toolName: "send_message",
                      args: {
                        segments: ["streamed hello"],
                        request_heartbeat: true,
                      },
                    },
                  ],
                },
              ],
            },
          });
        },
      }));

      const streamingAgent = new ChannelRuntime(createContextMock() as never, {
        bot: bot as never,
        sessionManager,
        settingsManager: createTestSettingsManager({
          response: {
            streaming: true,
          },
        }),
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-test",
      });

      await streamingAgent.receive(createEvent({ messageId: "msg-streaming" }));

      await vi.waitFor(() => {
        expect(bot.sendMessage).not.toHaveBeenCalled();
        expect(streamMock).toHaveBeenCalledTimes(1);
        expect(streamingAgent.getResponseState()).toBe("idle");
      });

      expect(
        sessionManager
          .getEntries()
          .some((entry) => entry.type === "message" && entry.message.role === "assistant"),
      ).toBe(true);
    });

    it('transitions idle -> responding -> aborting -> ended on abort (endReason === "abort")', async () => {
      const { agent, sessionManager } = createAgent();
      generateMock.mockImplementationOnce(async (input) => {
        await new Promise<void>((resolve, reject) => {
          input.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
          setTimeout(resolve, 1000);
        });
      });

      const receivePromise = agent.receive(createEvent({ messageId: "msg-abort" }));
      await vi.waitFor(() => {
        expect(agent.getResponseState()).toBe("responding");
      });
      agent.abort();
      await receivePromise;

      await vi.waitFor(() => {
        expect(agent.getResponseState()).toBe("idle");
      });
      const responseEnd = sessionManager
        .getEntries()
        .find((entry) => entry.type === "custom" && entry.customType === "response_end");
      expect(responseEnd).toBeTruthy();
      const responseEndData = responseEnd?.type === "custom" ? responseEnd.data : undefined;
      if (
        typeof responseEndData === "object" &&
        responseEndData !== null &&
        "endReason" in responseEndData
      ) {
        expect(responseEndData.endReason).toBe("abort");
      }
    });

    it('transitions idle -> responding -> ended on timeout (endReason === "timeout")', async () => {
      const { sessionManager } = createAgent();
      generateMock.mockImplementationOnce(async (input) => {
        await new Promise<void>((resolve, reject) => {
          input.abortSignal?.addEventListener("abort", () => reject(new Error("timed out")), {
            once: true,
          });
          setTimeout(resolve, 1000);
        });
      });

      const timeoutAgent = new ChannelRuntime(createContextMock() as never, {
        bot: createBotMock() as never,
        sessionManager,
        settingsManager: createTestSettingsManager({
          response: {
            baseTimeoutMs: 1,
            perStepTimeoutMs: 0,
            maxSteps: 1,
          },
        } satisfies AthenaSessionSettings),
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-test",
      });

      await timeoutAgent.receive(createEvent({ messageId: "msg-timeout" }));

      await vi.waitFor(() => {
        expect(timeoutAgent.getResponseState()).toBe("idle");
      });
      const responseEnd = sessionManager
        .getEntries()
        .find((entry) => entry.type === "custom" && entry.customType === "response_end");
      expect(responseEnd).toBeTruthy();
      const responseEndData = responseEnd?.type === "custom" ? responseEnd.data : undefined;
      if (
        typeof responseEndData === "object" &&
        responseEndData !== null &&
        "endReason" in responseEndData
      ) {
        expect(responseEndData.endReason).toBe("timeout");
      }
    });
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

    it("merges burst input into one follow-up turn", async () => {
      const { agent, sessionManager } = createAgent();
      let releaseFirst!: () => void;
      const firstTurn = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      generateMock.mockImplementationOnce(async () => {
        await firstTurn;
      });
      generateMock.mockResolvedValueOnce();

      const [firstEvent, secondEvent, thirdEvent] = createBurstEvents([
        "msg-burst-1",
        "msg-burst-2",
        "msg-burst-3",
      ]);

      const first = agent.receive(firstEvent);

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
        expect(agent.getResponseState()).toBe("responding");
      });

      const second = agent.receive(secondEvent);
      const third = agent.receive(thirdEvent);

      releaseFirst();
      await Promise.all([first, second, third]);

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(2);
      });

      const responseEndRecords = sessionManager
        .getEntries()
        .filter((entry) => entry.type === "custom" && entry.customType === "response_end");

      expect(responseEndRecords).toHaveLength(2);
      if (responseEndRecords[0]?.type === "custom") {
        expect(responseEndRecords[0].data).toMatchObject({ nextOutcome: "follow_up" });
      }
      if (responseEndRecords[1]?.type === "custom") {
        expect(responseEndRecords[1].data).toMatchObject({ nextOutcome: "idle" });
      }
    });
  });

  describe("protocol guidance retry behavior", () => {
    it("keeps one protocol_guidance entry when retry still violates protocol", async () => {
      const { agent, sessionManager } = createAgent();
      generateMock
        .mockImplementationOnce(async () => {
          const options = toolLoopAgentCtorMock.mock.calls[0]?.[0] as
            | { onStepFinish?: (event: unknown) => void }
            | undefined;
          options?.onStepFinish?.({
            model: { provider: "test", modelId: "test:model" },
            usage: { inputTokens: 1, outputTokens: 1 },
            finishReason: "stop",
            response: {
              messages: [{ role: "assistant", content: [{ type: "text", text: "plain one" }] }],
            },
          });
        })
        .mockImplementationOnce(async () => {
          const options = toolLoopAgentCtorMock.mock.calls[1]?.[0] as
            | { onStepFinish?: (event: unknown) => void }
            | undefined;
          options?.onStepFinish?.({
            model: { provider: "test", modelId: "test:model" },
            usage: { inputTokens: 1, outputTokens: 1 },
            finishReason: "stop",
            response: {
              messages: [{ role: "assistant", content: [{ type: "text", text: "plain two" }] }],
            },
          });
        });

      await agent.receive(createEvent({ messageId: "msg-guidance-single" }));

      await vi.waitFor(() => {
        expect(agent.getResponseState()).toBe("idle");
        expect(generateMock).toHaveBeenCalledTimes(2);
      });

      const guidanceEntries = sessionManager
        .getEntries()
        .filter(
          (entry) => entry.type === "custom_message" && entry.customType === "protocol_guidance",
        );
      expect(guidanceEntries).toHaveLength(1);
    });
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
        expect(responseEnd.data).toMatchObject({ endReason: "exception" });
      }
    });
  });

  describe("TurnFinalizer", () => {
    it("selects one deterministic post-turn outcome", () => {
      const finalizer = new TurnFinalizer();

      expect(
        finalizer.selectOutcome({
          endReason: "normal",
          hasPendingFollowUp: true,
        }),
      ).toEqual({ nextOutcome: "follow_up" });

      expect(
        finalizer.selectOutcome({
          endReason: "exception",
          hasPendingFollowUp: true,
          thrownError: "transport failed",
        }),
      ).toEqual({
        nextOutcome: "blocked",
        blockedReason: "transport failed",
      });

      expect(
        finalizer.selectOutcome({
          endReason: "normal",
          hasPendingFollowUp: false,
        }),
      ).toEqual({ nextOutcome: "idle" });
    });

    it("keeps heartbeat continuation on the same deterministic path", () => {
      const finalizer = new TurnFinalizer();

      expect(
        finalizer.selectOutcome({
          endReason: "heartbeat_continuation",
          hasPendingFollowUp: false,
        }),
      ).toEqual({ nextOutcome: "idle" });
    });
  });
});
