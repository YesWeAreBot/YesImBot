import { describe, it, expect } from "vitest";

import { Agent } from "../../src/agent/agent.js";
import { AgentSession } from "../../src/session/agent-session.js";
import type { CustomMessage } from "../../src/session/messages.js";
import { convertToLlm } from "../../src/session/messages.js";
import { SessionManager } from "../../src/session/session-manager.js";

function createMockModel() {
  return {
    specificationVersion: "v3" as const,
    provider: "test",
    modelId: "test-model",
    defaultObjectGenerationMode: "json" as const,
    supportedUrls: {} as Record<string, RegExp[]>,
    doGenerate: async () => ({
      finishReason: "stop" as const,
      usage: { promptTokens: 0, completionTokens: 0 },
      content: [],
      response: { id: "test", timestamp: new Date(), modelId: "test" },
      providerMetadata: undefined,
      request: { body: "{}" },
    }),
    doStream: async () => ({
      stream: new ReadableStream({ start(c) { c.close(); } }),
    }),
  };
}

function createTestAgentAndSession(sessionManager: SessionManager) {
  const model = createMockModel();
  const agent = new Agent({
    model: model as any,
    convertToLlm: (messages) => convertToLlm(messages),
  });
  const session = new AgentSession({
    cwd: "/tmp/test",
    agent,
    sessionManager,
    contextWindow: 65536,
  });
  return { agent, session };
}

describe("AgentSession restores persisted messages on construction", () => {
  it("should restore regular messages from SessionManager", () => {
    const sm = SessionManager.inMemory("/tmp/test");

    // Simulate persisted messages (as if from a previous session)
    sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1000,
    });
    sm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "hi there" }],
      usage: { promptTokens: 10, completionTokens: 5 },
      finishReason: "stop",
      timestamp: 2000,
    });

    const { agent } = createTestAgentAndSession(sm);

    expect(agent.state.messages).toHaveLength(2);
    expect(agent.state.messages[0].role).toBe("user");
    expect(agent.state.messages[1].role).toBe("assistant");
  });

  it("should restore custom messages from SessionManager", () => {
    const sm = SessionManager.inMemory("/tmp/test");

    sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "test message" }],
      timestamp: 1000,
    });

    sm.appendCustomMessageEntry("athena:message", "hello world", true, {
      kind: "chat_message",
      senderName: "Alice",
      senderId: "123",
      platform: "onebot",
      channelId: "456",
      timestamp: 1000,
    });

    sm.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "response" }],
      usage: {},
      finishReason: "stop",
      timestamp: 3000,
    });

    const { agent } = createTestAgentAndSession(sm);

    expect(agent.state.messages).toHaveLength(3);
    expect(agent.state.messages[0].role).toBe("user");
    expect(agent.state.messages[1].role).toBe("custom");
    const customMsg = agent.state.messages[1] as CustomMessage;
    expect(customMsg.customType).toBe("athena:message");
    expect(customMsg.content).toBe("hello world");
    expect(agent.state.messages[2].role).toBe("assistant");
  });

  it("should restore custom messages that are convertible by convertAthenaMessages", () => {
    const sm = SessionManager.inMemory("/tmp/test");

    sm.appendCustomMessageEntry("athena:message", "Alice says hi", true, {
      kind: "chat_message",
      senderName: "Alice",
      senderId: "123",
      platform: "onebot",
      channelId: "456",
      timestamp: 1000,
    });

    const { agent } = createTestAgentAndSession(sm);

    expect(agent.state.messages).toHaveLength(1);
    const msg = agent.state.messages[0] as CustomMessage;
    expect(msg.role).toBe("custom");
    expect(msg.customType).toBe("athena:message");

    // Verify it can be converted by convertAthenaMessages (imported in runtime.ts)
    // The conversion is: athena:message with kind=chat_message → "senderName said: content"
    const llmMessages = convertToLlm(agent.state.messages);
    expect(llmMessages).toHaveLength(1);
    expect(llmMessages[0].role).toBe("user");
  });

  it("should have empty messages when SessionManager has no persisted entries", () => {
    const sm = SessionManager.inMemory("/tmp/test");

    const { agent } = createTestAgentAndSession(sm);

    expect(agent.state.messages).toHaveLength(0);
  });

  it("should not duplicate messages when new messages are added after restore", () => {
    const sm = SessionManager.inMemory("/tmp/test");

    sm.appendMessage({
      role: "user",
      content: [{ type: "text", text: "old message" }],
      timestamp: 1000,
    });

    const { agent } = createTestAgentAndSession(sm);

    expect(agent.state.messages).toHaveLength(1);

    // Simulate a new message being appended (as happens during normal operation)
    // This should NOT be duplicated
    const newMsg = {
      role: "user" as const,
      content: [{ type: "text", text: "new message" }],
      timestamp: 2000,
    };
    agent.state.messages = [...agent.state.messages, newMsg];

    expect(agent.state.messages).toHaveLength(2);
    expect(agent.state.messages[0]).toMatchObject({ role: "user" });
    expect(agent.state.messages[1]).toMatchObject({ role: "user" });
  });
});
