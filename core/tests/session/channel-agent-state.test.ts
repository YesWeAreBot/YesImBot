import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSession } from "../../src/services/session/agent-session";
import { ChannelRuntime } from "../../src/services/session/runtime";
import type { ChannelRuntimeSettingsManager } from "../../src/services/session/runtime/types";
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

function getLatestToolLoopAgentOptions(): Record<string, unknown> | undefined {
  const lastCall = toolLoopAgentCtorMock.mock.calls[toolLoopAgentCtorMock.mock.calls.length - 1];
  const firstArg = lastCall?.[0];
  if (typeof firstArg !== "object" || firstArg === null) {
    return undefined;
  }
  return firstArg as Record<string, unknown>;
}

function listTimelineStates(sessionManager: SessionManager, stateType: string) {
  return sessionManager
    .getTimeline()
    .filter((record) => record.kind === "state_change" && record.stateType === stateType);
}

function findTimelineState(sessionManager: SessionManager, stateType: string) {
  return listTimelineStates(sessionManager, stateType)[0];
}

function listResponseStatusNotices(sessionManager: SessionManager) {
  return sessionManager.getTimeline().filter((record) => {
    return (
      record.kind === "system_notice" &&
      record.materializationKey === "response_status" &&
      record.subType.startsWith("response_status_")
    );
  });
}

function findLatestResponseStatusNotice(sessionManager: SessionManager) {
  const records = listResponseStatusNotices(sessionManager);
  return records[records.length - 1];
}

const delayedProviderFailureMessage =
  "RetryError [AI_RetryError]: Failed after 3 attempts. Last error: AI_APICallError: Cannot connect to API: getaddrinfo EAI_AGAIN model.nekohouse.cafe";

interface MutableSettingsManager extends ChannelRuntimeSettingsManager {
  setResponseSettings(
    settings: NonNullable<ReturnType<ChannelRuntimeSettingsManager["getResponseSettings"]>>,
  ): void;
}

function createMutableSettingsManager(): MutableSettingsManager {
  let modelId = "test:model";
  let responseSettings: ReturnType<ChannelRuntimeSettingsManager["getResponseSettings"]> = {};

  return {
    reload(): never {
      throw new Error("reload should not be called in this test");
    },
    getReloadMetadata(): never {
      throw new Error("getReloadMetadata should not be called in this test");
    },
    getModel(): string {
      return modelId;
    },
    getJudgeSettings() {
      return undefined;
    },
    getCompactionSettings() {
      return {
        enabled: true,
        reserveTokens: 16384,
        keepRecentTokens: 20000,
        contextWindow: 128000,
      };
    },
    getResponseSettings() {
      return responseSettings;
    },
    getWorkspaceSettings() {
      return {
        enableWorkspace: false,
      };
    },
    getBuiltInInstructions(): string {
      return "test instructions";
    },
    getPromptResourceFilenames() {
      return undefined;
    },
    setResponseSettings(nextResponseSettings): void {
      responseSettings = nextResponseSettings;
    },
  };
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

    it("exposes active tools to prepareStep before generation starts", async () => {
      const { agent } = createAgent();
      let initialActiveTools: unknown;
      let prepareStepActiveTools: string[] | undefined;

      generateMock.mockImplementationOnce(async () => {
        const options = toolLoopAgentCtorMock.mock.calls[0]?.[0] as
          | {
              prepareStep?: (input: {
                steps: unknown[];
                stepNumber: number;
                model: unknown;
                messages: unknown[];
              }) => { activeTools?: string[] };
            }
          | undefined;

        initialActiveTools = Reflect.get(agent as object, "responseActiveTools");

        const prepareStepResult = options?.prepareStep?.({
          steps: [],
          stepNumber: 0,
          model: { provider: "test", modelId: "test:model" },
          messages: [{ role: "system", content: "test instructions" }],
        });

        prepareStepActiveTools = prepareStepResult?.activeTools;
      });

      await agent.receive(createEvent({ messageId: "msg-active-tools" }));

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
        expect(agent.getResponseState()).toBe("idle");
      });

      expect(initialActiveTools).toEqual(["send_message"]);
      expect(prepareStepActiveTools).toEqual(["send_message"]);
    });

    it("refreshes prepareStep messages with inbound channel_message entries that arrive mid-response", async () => {
      const { agent } = createAgent();
      let releaseRefresh!: () => void;
      const waitForRefresh = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      let refreshedMessages: unknown[] | undefined;

      generateMock
        .mockImplementationOnce(async (input) => {
          const options = getLatestToolLoopAgentOptions() as
            | {
                prepareStep?: (input: {
                  steps: unknown[];
                  stepNumber: number;
                  model: unknown;
                  messages: unknown[];
                }) => { activeTools?: string[]; messages?: unknown[] };
              }
            | undefined;

          await waitForRefresh;
          const prepareStepResult = options?.prepareStep?.({
            steps: [{ id: "step-1" }],
            stepNumber: 1,
            model: { provider: "test", modelId: "test:model" },
            messages: input.messages,
          });
          refreshedMessages = prepareStepResult?.messages;
        })
        .mockResolvedValueOnce();

      const first = agent.receive(createEvent({ messageId: "msg-refresh-1", content: "first" }));

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
        expect(agent.getResponseState()).toBe("responding");
      });

      const second = agent.receive(
        createEvent({ messageId: "msg-refresh-2", content: "stop now" }),
      );

      releaseRefresh();
      await Promise.all([first, second]);

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(2);
        expect(agent.getResponseState()).toBe("idle");
      });

      expect(refreshedMessages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("stop now"),
          }),
        ]),
      );
    });

    it("reuses the cached ToolLoopAgent across turns when settings stay stable", async () => {
      const ctx = createContextMock();
      const bot = createBotMock();
      const sessionManager = SessionManager.inMemory("discord:channel-1");
      const agent = new ChannelRuntime(ctx as never, {
        bot: bot as never,
        sessionManager,
        settingsManager: createMutableSettingsManager(),
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-test",
      });

      generateMock.mockResolvedValue(undefined);

      await agent.receive(createEvent({ messageId: "msg-reuse-1" }));
      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
        expect(agent.getResponseState()).toBe("idle");
      });

      await agent.receive(createEvent({ messageId: "msg-reuse-2" }));
      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(2);
        expect(agent.getResponseState()).toBe("idle");
      });

      expect(toolLoopAgentCtorMock).toHaveBeenCalledTimes(1);
      expect(ctx["yesimbot.model"].resolve).toHaveBeenCalledTimes(1);
    });

    it("rebuilds the ToolLoopAgent when constructor-bound turn settings change", async () => {
      const ctx = createContextMock();
      const bot = createBotMock();
      const sessionManager = SessionManager.inMemory("discord:channel-1");
      const settingsManager = createMutableSettingsManager();
      const agent = new ChannelRuntime(ctx as never, {
        bot: bot as never,
        sessionManager,
        settingsManager,
        platform: "discord",
        channelId: "channel-1",
        basePath: "/tmp/athena-test",
      });

      generateMock.mockResolvedValue(undefined);

      await agent.receive(createEvent({ messageId: "msg-rebuild-1" }));
      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
        expect(agent.getResponseState()).toBe("idle");
      });

      settingsManager.setResponseSettings({
        maxSteps: 1,
      });

      await agent.receive(createEvent({ messageId: "msg-rebuild-2" }));
      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(2);
        expect(agent.getResponseState()).toBe("idle");
      });

      expect(toolLoopAgentCtorMock).toHaveBeenCalledTimes(2);
      expect(ctx["yesimbot.model"].resolve).toHaveBeenCalledTimes(2);
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
        sessionManager.getTimeline().some((record) => record.kind === "assistant_message"),
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
      const responseStatus = findLatestResponseStatusNotice(sessionManager);
      expect(listResponseStatusNotices(sessionManager)).toHaveLength(1);
      expect(responseStatus).toBeTruthy();
      if (responseStatus?.kind === "system_notice") {
        expect(responseStatus.materializationKey).toBe("response_status");
        expect(responseStatus.visibility).toBe("hidden");
        expect(responseStatus.materialization).toBe("hidden");
        expect(responseStatus.data).toMatchObject({
          endReason: "abort",
          nextAction: "idle",
          stepsCompleted: 0,
        });
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
      const responseStatus = findLatestResponseStatusNotice(sessionManager);
      expect(listResponseStatusNotices(sessionManager)).toHaveLength(1);
      expect(responseStatus).toBeTruthy();
      if (responseStatus?.kind === "system_notice") {
        expect(responseStatus.materializationKey).toBe("response_status");
        expect(responseStatus.visibility).toBe("hidden");
        expect(responseStatus.materialization).toBe("hidden");
        expect(responseStatus.data).toMatchObject({
          endReason: "timeout",
          nextAction: "blocked",
          blockedReason: "timeout",
          stepsCompleted: 0,
        });
      }

      const session = new AgentSession(sessionManager);
      expect(
        session.getModelMessages().some((message) => {
          return typeof message.content === "string" && message.content.includes("response_status");
        }),
      ).toBe(false);
    });

    it('transitions idle -> responding -> ended on error (endReason === "exception")', async () => {
      const { agent, sessionManager } = createAgent();
      generateMock.mockRejectedValueOnce(new Error("tool exploded"));

      await agent.receive(createEvent({ messageId: "msg-error" }));

      await vi.waitFor(() => {
        expect(agent.getResponseState()).toBe("idle");
      });

      const responseStatus = findLatestResponseStatusNotice(sessionManager);
      expect(listResponseStatusNotices(sessionManager)).toHaveLength(1);
      expect(responseStatus).toBeTruthy();
      if (responseStatus?.kind === "system_notice") {
        expect(responseStatus.materializationKey).toBe("response_status");
        expect(responseStatus.visibility).toBe("hidden");
        expect(responseStatus.materialization).toBe("hidden");
        expect(responseStatus.data).toMatchObject({
          endReason: "exception",
          nextAction: "blocked",
          blockedReason: "tool exploded",
          error: "tool exploded",
          stepsCompleted: 0,
        });
      }
    });

    it("persists delayed provider/network rejection details after abort signal flips", async () => {
      const { agent, sessionManager } = createAgent();

      generateMock.mockImplementationOnce(async (input) => {
        await new Promise<void>((_resolve, reject) => {
          input.abortSignal?.addEventListener(
            "abort",
            () => {
              setTimeout(() => {
                reject(new Error(delayedProviderFailureMessage));
              }, 0);
            },
            { once: true },
          );
        });
      });

      const receivePromise = agent.receive(createEvent({ messageId: "msg-provider-race-failure" }));

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
        expect(agent.getResponseState()).toBe("responding");
      });

      agent.abort();
      await receivePromise;

      await vi.waitFor(() => {
        expect(agent.getResponseState()).toBe("idle");
      });

      const responseStatus = findLatestResponseStatusNotice(sessionManager);
      expect(responseStatus?.kind).toBe("system_notice");
      if (responseStatus?.kind === "system_notice") {
        expect(responseStatus.materializationKey).toBe("response_status");
        expect(responseStatus.visibility).toBe("hidden");
        expect(responseStatus.materialization).toBe("hidden");
        expect(responseStatus.data.endReason).not.toBe("normal");
        expect(responseStatus.data.error).toContain("RetryError");
        expect(responseStatus.data.error).toContain("EAI_AGAIN");
        expect(responseStatus.data.blockedReason).toContain("AI_APICallError");
      }
    });
  });

  describe("terminal state", () => {
    it("every run reaches terminal state", async () => {
      const { agent, sessionManager } = createAgent();
      generateMock.mockRejectedValueOnce(new Error("terminal failure"));

      await agent.receive(createEvent({ messageId: "msg-terminal" }));

      await vi.waitFor(() => {
        expect(agent.getResponseState()).toBe("idle");
      });

      expect(listResponseStatusNotices(sessionManager)).toHaveLength(1);
      expect((agent as ChannelRuntime).getResponseState()).toBe("idle");
    });
  });

  describe("continues after abort", () => {
    it("reuses session after abort", async () => {
      const { agent, sessionManager } = createAgent();

      generateMock
        .mockImplementationOnce(async (input) => {
          await new Promise<void>((_resolve, reject) => {
            input.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          });
        })
        .mockResolvedValueOnce();

      const firstReceive = agent.receive(createEvent({ messageId: "msg-recover-abort-1" }));

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
        expect(agent.getResponseState()).toBe("responding");
      });

      agent.abort();
      await firstReceive;

      await vi.waitFor(() => {
        expect(agent.getResponseState()).toBe("idle");
      });

      const sessionAfterFailure = new AgentSession(sessionManager);
      expect(
        sessionAfterFailure.getModelMessages().some((message) => {
          return typeof message.content === "string" && message.content.includes("response_status");
        }),
      ).toBe(false);

      await agent.receive(
        createEvent({ messageId: "msg-recover-abort-2", content: "hello again" }),
      );

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(2);
        expect(agent.getResponseState()).toBe("idle");
      });

      expect(
        sessionManager.getTimeline().filter((record) => record.kind === "channel_message"),
      ).toHaveLength(2);
      expect(listResponseStatusNotices(sessionManager)).toHaveLength(2);
      expect(generateMock.mock.calls[1]?.[0]?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("hello again"),
          }),
        ]),
      );
    });

    it("reuses session after timeout", async () => {
      const sessionManager = SessionManager.inMemory("discord:channel-1");
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

      generateMock
        .mockImplementationOnce(async (input) => {
          await new Promise<void>((_resolve, reject) => {
            input.abortSignal?.addEventListener("abort", () => reject(new Error("timed out")), {
              once: true,
            });
          });
        })
        .mockResolvedValueOnce();

      await timeoutAgent.receive(createEvent({ messageId: "msg-recover-timeout-1" }));

      await vi.waitFor(() => {
        expect(timeoutAgent.getResponseState()).toBe("idle");
      });

      const sessionAfterFailure = new AgentSession(sessionManager);
      expect(
        sessionAfterFailure.getModelMessages().some((message) => {
          return typeof message.content === "string" && message.content.includes("response_status");
        }),
      ).toBe(false);

      await timeoutAgent.receive(
        createEvent({ messageId: "msg-recover-timeout-2", content: "timeout recovered" }),
      );

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(2);
        expect(timeoutAgent.getResponseState()).toBe("idle");
      });

      expect(
        sessionManager.getTimeline().filter((record) => record.kind === "channel_message"),
      ).toHaveLength(2);
      expect(listResponseStatusNotices(sessionManager)).toHaveLength(2);
      expect(generateMock.mock.calls[1]?.[0]?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("timeout recovered"),
          }),
        ]),
      );
    });

    it("recovers on next valid input after delayed provider/network rejection while keeping failure hidden", async () => {
      const { agent, sessionManager } = createAgent();

      generateMock
        .mockImplementationOnce(async (input) => {
          await new Promise<void>((_resolve, reject) => {
            input.abortSignal?.addEventListener(
              "abort",
              () => {
                setTimeout(() => {
                  reject(new Error(delayedProviderFailureMessage));
                }, 0);
              },
              { once: true },
            );
          });
        })
        .mockResolvedValueOnce();

      const firstReceive = agent.receive(
        createEvent({ messageId: "msg-provider-race-recover-1", content: "first try" }),
      );

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
        expect(agent.getResponseState()).toBe("responding");
      });

      agent.abort();
      await firstReceive;

      await vi.waitFor(() => {
        expect(agent.getResponseState()).toBe("idle");
      });

      const sessionAfterFailure = new AgentSession(sessionManager);
      expect(
        sessionAfterFailure.getModelMessages().some((message) => {
          return typeof message.content === "string" && message.content.includes("response_status");
        }),
      ).toBe(false);

      const failedStatus = findLatestResponseStatusNotice(sessionManager);
      expect(failedStatus?.kind).toBe("system_notice");
      if (failedStatus?.kind === "system_notice") {
        expect(failedStatus.data.endReason).not.toBe("normal");
        expect(failedStatus.data.error).toContain("EAI_AGAIN");
      }

      await agent.receive(
        createEvent({
          messageId: "msg-provider-race-recover-2",
          content: "network recovered now reply normally",
        }),
      );

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(2);
        expect(agent.getResponseState()).toBe("idle");
      });

      expect(
        sessionManager.getTimeline().filter((record) => record.kind === "channel_message"),
      ).toHaveLength(2);
      expect(listResponseStatusNotices(sessionManager)).toHaveLength(2);
      expect(generateMock.mock.calls[1]?.[0]?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("network recovered now reply normally"),
          }),
        ]),
      );
    });
  });

  describe("never deadlocks", () => {
    it("returns to idle after error in generate", async () => {
      const { agent } = createAgent();
      generateMock.mockRejectedValueOnce(new Error("deadlock failure"));

      await agent.receive(createEvent({ messageId: "msg-deadlock-error" }));

      await vi.waitFor(() => {
        expect(agent.getResponseState()).toBe("idle");
      });
    });

    it("returns to idle after abort signal", async () => {
      const { agent } = createAgent();
      generateMock.mockImplementationOnce(async (input) => {
        await new Promise<void>((_resolve, reject) => {
          input.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      });

      const receivePromise = agent.receive(createEvent({ messageId: "msg-deadlock-abort" }));

      await vi.waitFor(() => {
        expect(agent.getResponseState()).toBe("responding");
      });

      agent.abort();
      await receivePromise;

      await vi.waitFor(() => {
        expect(agent.getResponseState()).toBe("idle");
      });
    });

    it("watchdog timer forces idle on stuck response", async () => {
      const sessionManager = SessionManager.inMemory("discord:channel-1");
      const watchdogAgent = new ChannelRuntime(createContextMock() as never, {
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

      generateMock.mockImplementationOnce(async () => {
        await new Promise<void>(() => undefined);
      });

      void watchdogAgent.receive(createEvent({ messageId: "msg-watchdog" }));

      await vi.waitFor(() => {
        expect(generateMock).toHaveBeenCalledTimes(1);
      });

      await vi.waitFor(() => {
        expect(watchdogAgent.getResponseState()).toBe("idle");
      });

      const responseStatus = findLatestResponseStatusNotice(sessionManager);
      expect(responseStatus?.kind).toBe("system_notice");
      if (responseStatus?.kind === "system_notice") {
        expect(responseStatus.data).toMatchObject({ endReason: "timeout", nextAction: "blocked" });
      }
    });
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

    it("records follow-up review state through the session timeline", async () => {
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

      const secondTurnInput = generateMock.mock.calls[1]?.[0];

      const responseStatusRecords = listResponseStatusNotices(sessionManager);
      const followUpReviewRecords = listTimelineStates(sessionManager, "follow_up_review");

      expect(responseStatusRecords).toHaveLength(2);
      expect(followUpReviewRecords).toHaveLength(1);
      if (responseStatusRecords[0]?.kind === "system_notice") {
        expect(responseStatusRecords[0].visibility).toBe("hidden");
        expect(responseStatusRecords[0].materialization).toBe("hidden");
        expect(responseStatusRecords[0].data).toMatchObject({ nextAction: "follow_up" });
      }
      if (responseStatusRecords[1]?.kind === "system_notice") {
        expect(responseStatusRecords[1].data).toMatchObject({ nextAction: "idle" });
      }
      if (followUpReviewRecords[0]?.kind === "state_change") {
        expect(followUpReviewRecords[0].data).toMatchObject({
          messageCount: 2,
          messageIds: ["msg-burst-2", "msg-burst-3"],
        });
        expect((followUpReviewRecords[0].data as { content?: string }).content).toContain(
          "Observed window:",
        );
        expect((followUpReviewRecords[0].data as { content?: string }).content).toContain(
          "Tracked message IDs: msg-burst-2, msg-burst-3",
        );
      }
      expect(secondTurnInput?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("[Follow-up Review]"),
          }),
        ]),
      );
    });
  });

  describe("protocol guidance retry behavior", () => {
    it("keeps one protocol_guidance entry when retry still violates protocol", async () => {
      const { agent, sessionManager } = createAgent();
      generateMock
        .mockImplementationOnce(async () => {
          const options = getLatestToolLoopAgentOptions() as
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
          const options = getLatestToolLoopAgentOptions() as
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
      expect(toolLoopAgentCtorMock).toHaveBeenCalledTimes(1);

      const guidanceEntries = sessionManager
        .getTimeline()
        .filter((entry) => entry.kind === "system_notice" && entry.subType === "protocol_guidance");
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
      const responseStatus = findLatestResponseStatusNotice(sessionManager);
      expect(listResponseStatusNotices(sessionManager)).toHaveLength(1);
      expect(responseStatus).toBeTruthy();
      if (responseStatus?.kind === "system_notice") {
        expect(responseStatus.materializationKey).toBe("response_status");
        expect(responseStatus.visibility).toBe("hidden");
        expect(responseStatus.materialization).toBe("hidden");
        expect(responseStatus.data).toMatchObject({
          endReason: "exception",
          nextAction: "blocked",
          blockedReason: "tool exploded",
          error: "tool exploded",
          stepsCompleted: 0,
        });
      }
    });
  });
});
