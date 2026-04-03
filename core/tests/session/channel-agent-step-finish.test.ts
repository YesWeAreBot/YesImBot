import { describe, expect, it, vi } from "vitest";

import {
  createAgentAssistantMessage,
  createSendMessageTool,
} from "../../src/services/session/runtime";

describe("ChannelRuntime handleStepFinish", () => {
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
});
