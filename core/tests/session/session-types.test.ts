import { describe, expect, it } from "vitest";

import type {
  AgentAssistantMessage,
  AgentCustomMessage,
  AgentMessage,
  AgentToolMessage,
  AgentUserMessage,
  ChannelMessageDetails,
} from "../../src/services/session/session-manager";

describe("session message types", () => {
  it("defines AgentMessage as a legacy persistable compatibility shape", () => {
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

    expect(messages).toHaveLength(4);
    expect(messages[1]).toMatchObject({ role: "custom", customType: "channel_message" });
  });

  it("supports channel message details", () => {
    const details: ChannelMessageDetails = {
      timestamp: Date.now(),
      userId: "user-1",
      username: "alice",
      nickname: "alice",
      identity: "direct-user",
      platform: "discord",
      channelId: "123",
      messageId: "msg-1",
      isDirect: true,
      atSelf: false,
      isReplyToBot: false,
    };

    expect(details.username).toBe("alice");
    expect(details.identity).toBe("direct-user");
  });
});
