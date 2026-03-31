import { existsSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChannelAgent,
  createSendMessageTool,
  type SendMessageResult,
} from "../../src/services/session/channel-agent";
import { SessionManager } from "../../src/services/session/session-manager";
import type { ChannelEvent } from "../../src/services/session/types";

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

function getStopWhen(): StopWhen {
  const options = toolLoopAgentCtorMock.mock.calls[0]?.[0] as { stopWhen?: StopWhen } | undefined;
  expect(options?.stopWhen).toBeTruthy();
  return options!.stopWhen!;
}

describe("ChannelAgent protocol", () => {
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
    const agent = new ChannelAgent(context as never, {
      bot: bot as never,
      sessionManager,
      platform: "discord",
      channelId: "channel-1",
      modelId: "test:model",
      basePath: "/tmp/athena-test",
      instructions: "test instructions",
      enableWorkspace: false,
    });

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

        const options = toolLoopAgentCtorMock.mock.calls[1]?.[0] as
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
    });

    const guidance = sessionManager
      .getEntries()
      .find((entry) => entry.type === "custom_message" && entry.customType === "protocol_guidance");
    expect(guidance).toBeTruthy();
    const responseEnd = sessionManager
      .getEntries()
      .find((entry) => entry.type === "custom" && entry.customType === "response_end");
    expect(responseEnd).toBeTruthy();
    if (responseEnd && responseEnd.type === "custom") {
      expect(responseEnd.data).toMatchObject({ endReason: "protocol_error" });
    }
    expect(
      sessionManager
        .getEntries()
        .some((entry) => entry.type === "custom" && entry.customType === "protocol_violation"),
    ).toBe(false);
  });

  it("response_end normal after successful send_message without heartbeat", async () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const context = createContextMock();
    const bot = createBotMock();
    const agent = new ChannelAgent(context as never, {
      bot: bot as never,
      sessionManager,
      platform: "discord",
      channelId: "channel-1",
      modelId: "test:model",
      basePath: "/tmp/athena-test",
      instructions: "test instructions",
      enableWorkspace: false,
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
      const responseEnd = sessionManager
        .getEntries()
        .find((entry) => entry.type === "custom" && entry.customType === "response_end");
      expect(responseEnd).toBeTruthy();
      if (responseEnd && responseEnd.type === "custom") {
        expect(responseEnd.data).toMatchObject({ endReason: "normal" });
      }
    });

    expect(shouldStop).toBe(true);
  });

  it("response_end heartbeat_continuation after successful send_message with requestHeartbeat true", async () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const context = createContextMock();
    const bot = createBotMock();
    const agent = new ChannelAgent(context as never, {
      bot: bot as never,
      sessionManager,
      platform: "discord",
      channelId: "channel-1",
      modelId: "test:model",
      basePath: "/tmp/athena-test",
      instructions: "test instructions",
      enableWorkspace: false,
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
      const responseEnd = sessionManager
        .getEntries()
        .find((entry) => entry.type === "custom" && entry.customType === "response_end");
      expect(responseEnd).toBeTruthy();
      if (responseEnd && responseEnd.type === "custom") {
        expect(responseEnd.data).toMatchObject({ endReason: "heartbeat_continuation" });
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
    const agent = new ChannelAgent(context as never, {
      bot: bot as never,
      sessionManager,
      platform: "discord",
      channelId: "channel-1",
      modelId: "test:model",
      basePath: "/tmp/athena-test",
      instructions: "test instructions",
      enableWorkspace: false,
    });

    generateMock.mockResolvedValueOnce();

    await agent.receive(createEvent({ messageId: "msg-reserved" }));

    await vi.waitFor(() => {
      const responseEnd = sessionManager
        .getEntries()
        .find((entry) => entry.type === "custom" && entry.customType === "response_end");
      expect(responseEnd).toBeTruthy();
      if (responseEnd && responseEnd.type === "custom") {
        expect(responseEnd.data).toMatchObject({ endReason: "exception" });
        expect((responseEnd.data as { error?: string }).error).toContain(
          "Tool name reserved: send_message",
        );
      }
    });
  });

  it("appends outbound channel_message entries from wrapped send_message tool results", async () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const context = createContextMock();
    const bot = createBotMock();
    const agent = new ChannelAgent(context as never, {
      bot: bot as never,
      sessionManager,
      platform: "discord",
      channelId: "channel-1",
      modelId: "test:model",
      basePath: "/tmp/athena-test",
      instructions: "test instructions",
      enableWorkspace: false,
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
      const outboundMessages = sessionManager
        .getEntries()
        .filter(
          (entry) =>
            entry.type === "custom_message" &&
            entry.customType === "channel_message" &&
            entry.details &&
            typeof entry.details === "object" &&
            "direction" in entry.details &&
            entry.details.direction === "outbound",
        );
      expect(outboundMessages).toHaveLength(1);
    });

    const toolMessage = sessionManager
      .getEntries()
      .find(
        (entry) =>
          entry.type === "message" &&
          entry.message.role === "tool" &&
          entry.message.content[0]?.type === "tool-result",
      );
    expect(toolMessage).toBeTruthy();
    if (toolMessage && toolMessage.type === "message" && toolMessage.message.role === "tool") {
      expect(toolMessage.message.content[0]?.result).toMatchObject({
        utteranceId: "utt-1",
        requestHeartbeat: true,
      });
      expect(toolMessage.message.content[0]?.result).not.toHaveProperty("type", "json");
    }

    const outboundMessage = sessionManager
      .getEntries()
      .find(
        (entry) =>
          entry.type === "custom_message" &&
          entry.customType === "channel_message" &&
          entry.details &&
          typeof entry.details === "object" &&
          "direction" in entry.details &&
          entry.details.direction === "outbound",
      );
    expect(outboundMessage).toMatchObject({
      content: "[assistant]: hello",
    });
  });

  it("ignores replayed send_message tool-call and tool-result records", async () => {
    const sessionManager = SessionManager.inMemory("discord:channel-1");
    const context = createContextMock();
    const bot = createBotMock();
    const agent = new ChannelAgent(context as never, {
      bot: bot as never,
      sessionManager,
      platform: "discord",
      channelId: "channel-1",
      modelId: "test:model",
      basePath: "/tmp/athena-test",
      instructions: "test instructions",
      enableWorkspace: false,
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
        .getEntries()
        .filter((entry) => entry.type === "message" && entry.message.role === "tool");
      expect(toolMessages).toHaveLength(1);
    });

    expect(
      sessionManager
        .getEntries()
        .filter(
          (entry) =>
            entry.type === "custom_message" &&
            entry.customType === "channel_message" &&
            entry.details &&
            typeof entry.details === "object" &&
            "direction" in entry.details &&
            entry.details.direction === "outbound",
        ),
    ).toHaveLength(1);
    expect(
      sessionManager
        .getEntries()
        .filter((entry) => entry.type === "message" && entry.message.role === "assistant"),
    ).toHaveLength(1);
  });

  it("removes legacy text output helper module", () => {
    expect(
      existsSync("/home/workspace/Athena/core/src/services/session/channel-agent/output.ts"),
    ).toBe(false);
  });
});
