import { describe, expect, it } from "vitest";

import type {
  AgentAssistantMessage,
  AgentCustomMessage,
  AgentMessage,
  AgentToolMessage,
  AgentUserMessage,
  InboundChannelMessageDetails,
  OutboundChannelMessageDetails,
  SessionContext,
} from "../../src/services/session/session-manager";

describe("session message types", () => {
  it("defines AgentMessage as the runtime session source of truth", () => {
    const user: AgentUserMessage = { role: "user", content: "hi", timestamp: 1 };
    const custom: AgentCustomMessage = {
      role: "custom",
      customType: "channel_message",
      content: "[alice]: hi",
      display: false,
      timestamp: 1,
    };
    const assistant: AgentAssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      timestamp: 2,
      provider: "openai",
      model: "gpt-4.1",
    };
    const tool: AgentToolMessage = {
      role: "tool",
      content: [],
      timestamp: 3,
    };

    const messages: AgentMessage[] = [user, custom, assistant, tool];
    const ctx: SessionContext = {
      agentMessages: messages,
      model: null,
      entryCount: messages.length,
    };

    expect(ctx.agentMessages).toHaveLength(4);
  });

  it("supports inbound and outbound channel message details", () => {
    const inbound: InboundChannelMessageDetails = {
      direction: "inbound",
      userId: "user-1",
      username: "alice",
      platform: "discord",
      channelId: "123",
      messageId: "msg-1",
      isDirect: true,
      atSelf: false,
      isReplyToBot: false,
    };
    const outbound: OutboundChannelMessageDetails = {
      direction: "outbound",
      platform: "discord",
      channelId: "123",
      toolCallId: "call-1",
      utteranceId: "utt-1",
      index: 0,
      messageIds: ["m-1"],
      requestHeartbeat: false,
    };

    expect(inbound.username).toBe("alice");
    expect(outbound.toolCallId).toBe("call-1");
  });
});
