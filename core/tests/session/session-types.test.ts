import { describe, expect, it } from "vitest";

import type {
  AgentAssistantMessage,
  AgentCustomMessage,
  AgentMessage,
  AgentToolMessage,
  AgentUserMessage,
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
});
