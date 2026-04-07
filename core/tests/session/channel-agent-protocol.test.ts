import { existsSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentSession } from "../../src/services/session/agent-session";
import {
  buildGenerateInputForTest,
  ChannelRuntime,
  createSendMessageTool,
  type SendMessageResult,
} from "../../src/services/session/runtime";
import { SessionManager } from "../../src/services/session/session-manager";
import type { ChannelEvent } from "../../src/services/session/types";
import { createTestSettingsManager } from "./test-settings-manager";

type GenerateInput = {
  messages: unknown[];
  abortSignal?: AbortSignal;
};

type StopWhen =
  | ((options: { steps: Array<Record<string, unknown>> }) => boolean)
  | Array<(options: { steps: Array<Record<string, unknown>> }) => boolean>;

const generateMock = vi.fn<(input: GenerateInput) => Promise<void>>();
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
  }

  return {
    ToolLoopAgent,
    stepCountIs: (n: number) => n,
  };
});

function createContextMock(toolSet: Record<string, unknown> = {}) {
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
    "yesimbot.plugin": {
      getToolSet: vi.fn(() => toolSet),
    },
  };
}

function createBotMock() {
  return {
    selfId: "bot-self",
    sendMessage: vi.fn().mockResolvedValue(["m-1"]),
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
      timestamp: 2000 + index,
    }),
  );
}

function createSendResult(overrides: Partial<SendMessageResult> = {}): SendMessageResult {
  return {
    toolCallId: "call-1",
    utteranceId: "utt-1",
    requestHeartbeat: false,
    success: true,
    segments: [
      {
        segmentId: "seg-1",
        index: 0,
        content: "hello",
        success: true,
        messageIds: ["m-1"],
      },
    ],
    ...overrides,
  };
}

function findTimelineState(sessionManager: SessionManager, stateType: string) {
  return sessionManager
    .getTimeline()
    .find((record) => record.kind === "state_change" && record.stateType === stateType);
}

function listTimelineStates(sessionManager: SessionManager, stateType: string) {
  return sessionManager
    .getTimeline()
    .filter((record) => record.kind === "state_change" && record.stateType === stateType);
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
  const notices = listResponseStatusNotices(sessionManager);
  return notices[notices.length - 1];
}

function getStopWhen(): StopWhen {
  const options = toolLoopAgentCtorMock.mock.calls[0]?.[0] as { stopWhen?: StopWhen } | undefined;
  expect(options?.stopWhen).toBeTruthy();
  return options!.stopWhen!;
}

function getLatestToolLoopAgentOptions(): Record<string, unknown> | undefined {
  const lastCall = toolLoopAgentCtorMock.mock.calls[toolLoopAgentCtorMock.mock.calls.length - 1];
  const firstArg = lastCall?.[0];
  if (typeof firstArg !== "object" || firstArg === null) {
    return undefined;
  }
  return firstArg as Record<string, unknown>;
}

describe("ChannelRuntime protocol", () => {
  beforeEach(() => {
    generateMock.mockReset();
    toolLoopAgentCtorMock.mockClear();
  });

  it("send_message sends segments in order and returns structured results", async () => {
    const bot = createBotMock();
    bot.sendMessage.mockResolvedValueOnce(["m-1"]).mockResolvedValueOnce(["m-2"]);

    const tool = createSendMessageTool({
      bot: bot as never,
      channelId: "channel-1",
    });

    const result = await tool.execute(
      {
        segments: ["hello", "world"],
        request_heartbeat: true,
      },
      { toolCallId: "call-two-segment" },
    );

    expect(bot.sendMessage).toHaveBeenNthCalledWith(1, "channel-1", "hello");
    expect(bot.sendMessage).toHaveBeenNthCalledWith(2, "channel-1", "world");
    expect(result).toMatchObject({
      toolCallId: "call-two-segment",
      requestHeartbeat: true,
      success: true,
      segments: [
        { index: 0, content: "hello", success: true, messageIds: ["m-1"] },
        { index: 1, content: "world", success: true, messageIds: ["m-2"] },
      ],
    });
  });

  it("empty payload returns unsuccessful result without sending", async () => {
    const bot = createBotMock();
    const tool = createSendMessageTool({
      bot: bot as never,
      channelId: "channel-1",
    });

    const result = await tool.execute({ content: "   <sep/>   " }, { toolCallId: "call-empty" });

    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      toolCallId: "call-empty",
      success: false,
      segments: [],
    });
  });

  it("second plain assistant text after one guidance ends protocol_error", async () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const context = createContextMock();
    const bot = createBotMock();
    const agent = new ChannelRuntime(context as never, {
      bot: bot as never,
      sessionManager,
      settingsManager: createTestSettingsManager(),
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-test",
    });

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
            messages: [{ role: "assistant", content: [{ type: "text", text: "visible text" }] }],
          },
        });
      })
      .mockImplementationOnce(async (input) => {
        expect(input.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              content: expect.stringContaining(
                "Visible IM replies must be sent with the send_message tool",
              ),
            }),
          ]),
        );

        const options = getLatestToolLoopAgentOptions() as
          | { onStepFinish?: (event: unknown) => void }
          | undefined;
        options?.onStepFinish?.({
          model: { provider: "test", modelId: "test:model" },
          usage: { inputTokens: 1, outputTokens: 1 },
          finishReason: "stop",
          response: {
            messages: [{ role: "assistant", content: [{ type: "text", text: "still plain" }] }],
          },
        });
      });

    await agent.receive(createEvent({ messageId: "msg-protocol-retry" }));

    await vi.waitFor(() => {
      expect(generateMock).toHaveBeenCalledTimes(2);
      expect(agent.getResponseState()).toBe("idle");
    });
    expect(toolLoopAgentCtorMock).toHaveBeenCalledTimes(1);

    const guidance = sessionManager
      .getTimeline()
      .find((record) => record.kind === "system_notice" && record.subType === "protocol_guidance");
    expect(guidance).toBeTruthy();
    expect(
      sessionManager.getTimeline().filter((record) => record.kind === "assistant_message"),
    ).toHaveLength(0);
    const responseStatus = findLatestResponseStatusNotice(sessionManager);
    expect(listResponseStatusNotices(sessionManager)).toHaveLength(1);
    expect(responseStatus).toBeTruthy();
    if (responseStatus?.kind === "system_notice") {
      expect(responseStatus.materializationKey).toBe("response_status");
      expect(responseStatus.visibility).toBe("hidden");
      expect(responseStatus.materialization).toBe("hidden");
      expect(responseStatus.data).toMatchObject({
        endReason: "protocol_error",
        nextAction: "blocked",
        blockedReason: "protocol_error",
        stepsCompleted: 1,
      });
    }
    expect(findTimelineState(sessionManager, "protocol_violation")).toBeUndefined();

    const draftEntries = listTimelineStates(sessionManager, "protocol_assistant_draft");
    expect(draftEntries).toHaveLength(2);
    expect(draftEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ text: "visible text" }),
        }),
        expect.objectContaining({
          data: expect.objectContaining({ text: "still plain" }),
        }),
      ]),
    );

    const session = new AgentSession(sessionManager);
    const sessionMessages = session.getModelMessages();
    expect(
      sessionMessages.some(
        (msg) =>
          msg.role === "user" &&
          typeof msg.content === "string" &&
          msg.content.includes("Visible IM replies must be sent with the send_message tool"),
      ),
    ).toBe(false);
    expect(
      sessionMessages.some(
        (msg) =>
          msg.role === "assistant" &&
          typeof msg.content === "string" &&
          (msg.content.includes("visible text") || msg.content.includes("still plain")),
      ),
    ).toBe(false);

    const rebuilt = buildGenerateInputForTest({
      instructions: "next run",
      session,
    });
    expect(
      rebuilt.messages.some(
        (msg) =>
          msg.role === "user" &&
          typeof msg.content === "string" &&
          msg.content.includes("Visible IM replies must be sent with the send_message tool"),
      ),
    ).toBe(false);
    expect(
      rebuilt.messages.some(
        (msg) =>
          msg.role === "assistant" &&
          typeof msg.content === "string" &&
          (msg.content.includes("visible text") || msg.content.includes("still plain")),
      ),
    ).toBe(false);
  });

  it("persists normal response status notice after successful send_message without heartbeat", async () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const context = createContextMock();
    const bot = createBotMock();
    const agent = new ChannelRuntime(context as never, {
      bot: bot as never,
      sessionManager,
      settingsManager: createTestSettingsManager(),
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-test",
    });

    generateMock.mockImplementationOnce(async () => {
      const options = toolLoopAgentCtorMock.mock.calls[0]?.[0] as
        | { onStepFinish?: (event: unknown) => void }
        | undefined;
      options?.onStepFinish?.({
        model: { provider: "test", modelId: "test:model" },
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: "tool-calls",
        response: {
          messages: [
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: "call-1",
                  toolName: "send_message",
                  output: {
                    type: "json",
                    value: createSendResult(),
                  },
                },
              ],
            },
          ],
        },
      });
    });

    await agent.receive(createEvent({ messageId: "msg-stop-after-send" }));

    await vi.waitFor(() => {
      expect(toolLoopAgentCtorMock).toHaveBeenCalledTimes(1);
    });

    const stopWhen = getStopWhen();
    const stopConditions = (Array.isArray(stopWhen) ? stopWhen : [stopWhen]).filter(
      (condition): condition is (options: { steps: Array<Record<string, unknown>> }) => boolean =>
        typeof condition === "function",
    );
    const shouldStop = stopConditions.some((condition) =>
      condition({
        steps: [
          {
            toolResults: [
              {
                toolName: "send_message",
                output: createSendResult(),
              },
            ],
          },
        ],
      }),
    );

    await vi.waitFor(() => {
      const responseStatus = findLatestResponseStatusNotice(sessionManager);
      expect(responseStatus).toBeTruthy();
      if (responseStatus?.kind === "system_notice") {
        expect(responseStatus.materializationKey).toBe("response_status");
        expect(responseStatus.data).toMatchObject({ endReason: "normal" });
      }
    });

    expect(shouldStop).toBe(true);
  });

  it("stopWhen also stops after a successful send_message without heartbeat when step toolResults are missing", async () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const context = createContextMock();
    const bot = createBotMock();
    const agent = new ChannelRuntime(context as never, {
      bot: bot as never,
      sessionManager,
      settingsManager: createTestSettingsManager(),
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-test",
    });

    generateMock.mockImplementationOnce(async () => {
      const options = toolLoopAgentCtorMock.mock.calls[0]?.[0] as
        | { onStepFinish?: (event: unknown) => void }
        | undefined;
      options?.onStepFinish?.({
        model: { provider: "test", modelId: "test:model" },
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: "tool-calls",
        response: {
          messages: [
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: "call-1",
                  toolName: "send_message",
                  output: {
                    type: "json",
                    value: createSendResult(),
                  },
                },
              ],
            },
          ],
        },
      });
    });

    await agent.receive(
      createEvent({ messageId: "msg-stop-after-send-missing-step-tool-results" }),
    );

    await vi.waitFor(() => {
      expect(toolLoopAgentCtorMock).toHaveBeenCalledTimes(1);
    });

    const stopWhen = getStopWhen();
    const stopConditions = (Array.isArray(stopWhen) ? stopWhen : [stopWhen]).filter(
      (condition): condition is (options: { steps: Array<Record<string, unknown>> }) => boolean =>
        typeof condition === "function",
    );
    const shouldStop = stopConditions.some((condition) =>
      condition({
        steps: [
          {
            toolResults: [],
          },
        ],
      }),
    );

    expect(shouldStop).toBe(true);
  });

  it("persists heartbeat continuation response status notice after successful send_message", async () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const context = createContextMock();
    const bot = createBotMock();
    const agent = new ChannelRuntime(context as never, {
      bot: bot as never,
      sessionManager,
      settingsManager: createTestSettingsManager(),
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-test",
    });

    generateMock.mockImplementationOnce(async () => {
      const options = toolLoopAgentCtorMock.mock.calls[0]?.[0] as
        | { onStepFinish?: (event: unknown) => void }
        | undefined;
      options?.onStepFinish?.({
        model: { provider: "test", modelId: "test:model" },
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: "tool-calls",
        response: {
          messages: [
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: "call-1",
                  toolName: "send_message",
                  output: {
                    type: "json",
                    value: createSendResult({ requestHeartbeat: true }),
                  },
                },
              ],
            },
          ],
        },
      });
    });

    await agent.receive(createEvent({ messageId: "msg-heartbeat-after-send" }));

    await vi.waitFor(() => {
      const responseStatus = findLatestResponseStatusNotice(sessionManager);
      expect(responseStatus).toBeTruthy();
      if (responseStatus?.kind === "system_notice") {
        expect(responseStatus.materializationKey).toBe("response_status");
        expect(responseStatus.data).toMatchObject({ endReason: "heartbeat_continuation" });
      }
    });
  });

  it("reserved send_message tool collision persists exception", async () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const context = createContextMock({
      send_message: {
        description: "plugin send",
        inputSchema: {},
        execute: async () => ({ ok: true }),
      },
    });
    const bot = createBotMock();
    const agent = new ChannelRuntime(context as never, {
      bot: bot as never,
      sessionManager,
      settingsManager: createTestSettingsManager(),
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-test",
    });

    generateMock.mockResolvedValueOnce();

    await agent.receive(createEvent({ messageId: "msg-reserved" }));

    await vi.waitFor(() => {
      const responseStatus = findLatestResponseStatusNotice(sessionManager);
      expect(responseStatus).toBeTruthy();
      if (responseStatus?.kind === "system_notice") {
        expect(responseStatus.materializationKey).toBe("response_status");
        expect(responseStatus.data).toMatchObject({ endReason: "exception" });
        expect((responseStatus.data as { error?: string }).error).toContain(
          "Tool name reserved: send_message",
        );
      }
    });
  });

  it("does not append outbound channel_message entries from send_message tool results", async () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const context = createContextMock();
    const bot = createBotMock();
    const agent = new ChannelRuntime(context as never, {
      bot: bot as never,
      sessionManager,
      settingsManager: createTestSettingsManager(),
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-test",
    });

    generateMock.mockImplementationOnce(async () => {
      const options = toolLoopAgentCtorMock.mock.calls[0]?.[0] as
        | { onStepFinish?: (event: unknown) => void }
        | undefined;
      options?.onStepFinish?.({
        model: { provider: "test", modelId: "test:model" },
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: "stop",
        response: {
          messages: [
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: "call-1",
                  toolName: "send_message",
                  output: {
                    type: "json",
                    value: createSendResult({ requestHeartbeat: true }),
                  },
                },
              ],
            },
          ],
        },
      });
    });

    await agent.receive(createEvent({ messageId: "msg-project" }));

    await vi.waitFor(() => {
      const channelMessages = sessionManager
        .getTimeline()
        .filter((record) => record.kind === "channel_message");
      expect(channelMessages).toHaveLength(1);
    });

    const toolMessage = sessionManager
      .getTimeline()
      .find(
        (record) =>
          record.kind === "tool_message" && record.message.content[0]?.type === "tool-result",
      );
    expect(toolMessage).toBeTruthy();
    if (toolMessage?.kind === "tool_message") {
      expect(toolMessage.message.content[0]?.output).toMatchObject({
        type: "json",
        value: expect.objectContaining({
          utteranceId: "utt-1",
          requestHeartbeat: true,
        }),
      });
    }
  });

  it("ignores replayed send_message tool-call and tool-result records", async () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const context = createContextMock();
    const bot = createBotMock();
    const agent = new ChannelRuntime(context as never, {
      bot: bot as never,
      sessionManager,
      settingsManager: createTestSettingsManager(),
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-test",
    });

    generateMock.mockImplementationOnce(async () => {
      const options = toolLoopAgentCtorMock.mock.calls[0]?.[0] as
        | { onStepFinish?: (event: unknown) => void }
        | undefined;
      const replayedStep = {
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
                  toolCallId: "call-replay",
                  toolName: "send_message",
                  args: { content: "hello", request_heartbeat: false, segments: [] },
                },
              ],
            },
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: "call-replay",
                  toolName: "send_message",
                  output: {
                    type: "json",
                    value: createSendResult({
                      toolCallId: "call-replay",
                      utteranceId: "utt-replay",
                      segments: [
                        {
                          segmentId: "seg-replay",
                          index: 0,
                          content: "hello",
                          success: true,
                          messageIds: ["m-1"],
                        },
                      ],
                    }),
                  },
                },
              ],
            },
          ],
        },
      };

      options?.onStepFinish?.(replayedStep);
      options?.onStepFinish?.(replayedStep);
    });

    await agent.receive(createEvent({ messageId: "msg-replay" }));

    await vi.waitFor(() => {
      const toolMessages = sessionManager
        .getTimeline()
        .filter((record) => record.kind === "tool_message");
      expect(toolMessages).toHaveLength(1);
    });

    expect(
      sessionManager.getTimeline().filter((record) => record.kind === "channel_message"),
    ).toHaveLength(1);
    expect(
      sessionManager.getTimeline().filter((record) => record.kind === "assistant_message"),
    ).toHaveLength(1);
  });

  it("removes legacy text output helper module", () => {
    expect(existsSync("/home/workspace/Athena/core/src/services/session/runtime/output.ts")).toBe(
      false,
    );
  });

  it("runs at most one follow-up after a burst arrives during an active turn", async () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const context = createContextMock();
    const bot = createBotMock();
    const agent = new ChannelRuntime(context as never, {
      bot: bot as never,
      sessionManager,
      settingsManager: createTestSettingsManager(),
      platform: "discord",
      channelId: "channel-1",
      basePath: "/tmp/athena-test",
    });

    let releaseFirst!: () => void;
    const firstTurn = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    generateMock.mockImplementationOnce(async () => {
      await firstTurn;
    });
    generateMock.mockResolvedValueOnce();

    const [firstEvent, secondEvent, thirdEvent] = createBurstEvents([
      "msg-protocol-burst-1",
      "msg-protocol-burst-2",
      "msg-protocol-burst-3",
    ]);

    const first = agent.receive(firstEvent);

    await vi.waitFor(() => {
      expect(generateMock).toHaveBeenCalledTimes(1);
    });

    const second = agent.receive(secondEvent);
    const third = agent.receive(thirdEvent);

    releaseFirst();
    await Promise.all([first, second, third]);

    await vi.waitFor(() => {
      expect(generateMock).toHaveBeenCalledTimes(2);
    });

    const responseStatusRecords = listResponseStatusNotices(sessionManager);
    const followUpReviewRecords = listTimelineStates(sessionManager, "follow_up_review");

    expect(responseStatusRecords).toHaveLength(2);
    expect(followUpReviewRecords).toHaveLength(1);
    if (followUpReviewRecords[0]?.kind === "state_change") {
      expect(followUpReviewRecords[0].data).toMatchObject({
        messageCount: 2,
        messageIds: ["msg-protocol-burst-2", "msg-protocol-burst-3"],
      });
      expect((followUpReviewRecords[0].data as { content?: string }).content).toContain(
        "Observed window:",
      );
      expect((followUpReviewRecords[0].data as { content?: string }).content).toContain(
        "Tracked message IDs: msg-protocol-burst-2, msg-protocol-burst-3",
      );
    }
    if (responseStatusRecords[0]?.kind === "system_notice") {
      expect(responseStatusRecords[0].materializationKey).toBe("response_status");
      expect(responseStatusRecords[0].data).toMatchObject({ nextAction: "follow_up" });
    }
    if (responseStatusRecords[1]?.kind === "system_notice") {
      expect(responseStatusRecords[1].data).toMatchObject({ nextAction: "idle" });
    }
  });
});
