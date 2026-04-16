import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { ToolSet } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateMock } = vi.hoisted(() => ({
  generateMock: vi.fn<(input: Record<string, unknown>) => Promise<void>>(),
}));

vi.mock("ai", () => {
  class ToolLoopAgent {
    readonly tools: ToolSet;

    constructor(settings: Record<string, unknown>) {
      this.tools = (settings.tools as ToolSet | undefined) ?? {};
    }

    async generate(input: Record<string, unknown>): Promise<void> {
      return generateMock(input);
    }

    async stream(): Promise<never> {
      throw new Error("stream should not be called in this test");
    }
  }

  return {
    ToolLoopAgent,
    stepCountIs: (n: number) => n,
  };
});

vi.mock("../../src/services/session/runtime/model-adapter", () => ({
  prepareRuntimeModel: vi.fn(() => ({
    fullId: "test:model",
    providerId: "test-provider",
    modelId: "test-model",
    entry: {
      id: "test-model",
      toolCall: true,
      reasoning: false,
    },
    model: {
      specificationVersion: "v3",
      provider: "test-provider",
      modelId: "test-model",
      defaultObjectGenerationMode: "json",
      supportsImageUrls: false,
      supportsUrl: () => false,
      doGenerate: vi.fn(),
      doStream: vi.fn(),
    } as unknown as LanguageModelV3,
  })),
}));

import {
  ChannelRuntime,
  createAgentAssistantMessage,
  createSendMessageTool,
} from "../../src/services/session/runtime";
import { SessionManager } from "../../src/services/session/session-manager";
import { createTestSettingsManager } from "./test-settings-manager";

describe("ChannelRuntime handleStepFinish", () => {
  beforeEach(() => {
    generateMock.mockReset();
    generateMock.mockResolvedValue(undefined);
  });

  it("normalizes assistant reasoning blocks and usage metadata into AgentMessage payloads", () => {
    const persisted = createAgentAssistantMessage({
      content: [
        { type: "reasoning", text: "considering options" },
        { type: "text", text: "final answer" },
      ],
      usage: { inputTokens: 10, outputTokens: 5, cacheRead: 7, cacheWrite: 3 },
      finishReason: "stop",
    });

    expect(persisted).toMatchObject({
      role: "assistant",
      content: [
        { type: "thinking", text: "considering options" },
        { type: "text", text: "final answer" },
      ],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheRead: 7, cacheWrite: 3 },
      finishReason: "stop",
    });
  });

  it("drops placeholder zero usage records", () => {
    const persisted = createAgentAssistantMessage({
      content: [{ type: "text", text: "final answer" }],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0 },
      finishReason: "stop",
    });

    expect(persisted.usage).toBeUndefined();
  });

  describe("send_message tool", () => {
    it("normalizes segments from content split and trim", async () => {
      const bot = {
        sendMessage: vi.fn().mockResolvedValueOnce(["msg-0"]).mockResolvedValueOnce(["msg-1"]),
      };
      const tool = createSendMessageTool({
        bot: bot as never,
        channelId: "channel-1",
      });

      const result = await tool.execute(
        { content: "  hello  <sep/>   world   <sep/>  " },
        { toolCallId: "call-1" },
      );

      expect(bot.sendMessage).toHaveBeenNthCalledWith(1, "channel-1", "hello");
      expect(bot.sendMessage).toHaveBeenNthCalledWith(2, "channel-1", "world");
      expect(result).toMatchObject({
        toolCallId: "call-1",
        requestHeartbeat: false,
        success: true,
        segments: [
          { index: 0, content: "hello", success: true, messageIds: ["msg-0"] },
          { index: 1, content: "world", success: true, messageIds: ["msg-1"] },
        ],
      });
      expect(result.segments[0]?.segmentId).toMatch(/^[0-9a-f-]+:0$/);
    });

    it("returns failure on invalid payload without sending", async () => {
      const bot = {
        sendMessage: vi.fn(),
      };
      const tool = createSendMessageTool({
        bot: bot as never,
        channelId: "channel-1",
      });

      const result = await tool.execute(
        { segments: ["   ", ""] },
        { toolCallId: "call-invalid-1" },
      );

      expect(bot.sendMessage).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        toolCallId: "call-invalid-1",
        success: false,
        segments: [],
      });
    });

    it("stops on first send failure and returns partial results", async () => {
      const bot = {
        sendMessage: vi
          .fn()
          .mockResolvedValueOnce(["msg-0"])
          .mockRejectedValueOnce(new Error("send failed")),
      };
      const tool = createSendMessageTool({
        bot: bot as never,
        channelId: "channel-1",
      });

      const result = await tool.execute(
        { segments: ["first", "second"] },
        { toolCallId: "call-failure" },
      );

      expect(bot.sendMessage).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        toolCallId: "call-failure",
        success: false,
        segments: [
          { index: 0, content: "first", success: true, messageIds: ["msg-0"] },
          { index: 1, content: "second", success: false, error: "send failed" },
        ],
      });
    });
  });

  describe("tool lifecycle cache", () => {
    it("reuses the compiled supported tool signature across multiple responses while recalculating active tools", async () => {
      const sendMessageTool = createSendMessageTool({
        bot: {
          selfId: "bot-self",
          sendMessage: vi.fn(),
        } as never,
        channelId: "channel-1",
      });
      const compileToolsSpy = vi.fn(async () => ({
        tools: {},
        handles: {},
        signature: "compiled-once-signature",
      }));
      const buildContextSpy = vi.fn(async () => ({}));
      const selectToolsSpy = vi.fn(async () => ({
        activeTools: { send_message: sendMessageTool },
        activeToolNames: ["send_message"],
        responseContext: {},
      }));
      const runtime = new ChannelRuntime(
        {
          logger: vi.fn(() => ({
            level: 2,
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
          })),
          "yesimbot.model": {
            resolveRegistration: vi.fn(),
            resolve: vi.fn(),
          },
          "yesimbot.plugin": {
            compileTools: compileToolsSpy,
            buildContext: buildContextSpy,
            selectTools: selectToolsSpy,
            getToolDefinitions: vi.fn(() => []),
            install: vi.fn(),
            remove: vi.fn(),
            list: vi.fn(() => []),
            invoke: vi.fn(),
          },
        } as never,
        {
          bot: {
            selfId: "bot-self",
            userId: "bot-user",
            sendMessage: vi.fn(),
          } as never,
          sessionManager: SessionManager.inMemory("discord:channel-1"),
          settingsManager: createTestSettingsManager({}),
          platform: "discord",
          channelId: "channel-1",
          basePath: "/tmp/athena-runtime-step-finish",
        },
      );
      const syncAgentToolsSpy = vi.spyOn(runtime as never, "syncAgentTools");
      const runResponse = Reflect.get(runtime as object, "runResponse") as
        | (() => Promise<void>)
        | undefined;
      if (!runResponse) {
        throw new Error("ChannelRuntime.runResponse is unavailable");
      }

      await runResponse.call(runtime);
      const firstSignature = runtime.currentSupportedToolSignature;

      await runResponse.call(runtime);

      expect(runtime.currentSupportedToolSignature).toBe(firstSignature);
      expect(compileToolsSpy).toHaveBeenCalledTimes(1);
      expect(buildContextSpy).toHaveBeenCalledTimes(2);
      expect(syncAgentToolsSpy).toHaveBeenCalledTimes(1);
      expect(selectToolsSpy).toHaveBeenCalledTimes(2);
    });
  });
});
