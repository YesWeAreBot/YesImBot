import { Context } from "koishi";
import { describe, expect, it } from "vitest";

import type { LoopMessage } from "../src/services/agent/trimmer";
import {
  MessageHandler,
  AgentResponseHandler,
  AgentActionHandler,
  type BuildContextOptions,
  type MessageRecord,
  type AgentResponseRecord,
  type AgentActionRecord,
} from "../src/services/horizon/handlers";
import { EventManager } from "../src/services/horizon/manager";
import { TimelineEventType, TimelineStage, TimelinePriority } from "../src/services/horizon/types";

/**
 * Helper to create a MessageRecord for testing.
 */
function createMessageRecord(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: "msg-1",
    timestamp: new Date("2026-03-03T13:32:00Z"),
    platform: "test",
    channelId: "test-channel",
    type: TimelineEventType.Message,
    priority: TimelinePriority.Normal,
    stage: TimelineStage.Active,
    data: {
      messageId: "native-msg-1",
      senderId: "user-123",
      senderName: "Alice",
      content: "Hello world",
    },
    ...overrides,
  } as MessageRecord;
}

/**
 * Helper to create an AgentResponseRecord for testing.
 */
function createAgentResponseRecord(
  overrides: Partial<AgentResponseRecord> = {},
): AgentResponseRecord {
  return {
    id: "resp-1",
    timestamp: new Date("2026-03-03T13:32:00Z"),
    platform: "test",
    channelId: "test-channel",
    type: TimelineEventType.AgentResponse,
    priority: TimelinePriority.Normal,
    stage: TimelineStage.Active,
    data: {
      rawText: "This is a response",
    },
    ...overrides,
  } as AgentResponseRecord;
}

/**
 * Helper to create an AgentActionRecord for testing.
 */
function createAgentActionRecord(overrides: Partial<AgentActionRecord> = {}): AgentActionRecord {
  return {
    id: "action-1",
    timestamp: new Date("2026-03-03T13:32:00Z"),
    platform: "test",
    channelId: "test-channel",
    type: TimelineEventType.AgentAction,
    priority: TimelinePriority.Normal,
    stage: TimelineStage.Active,
    data: {
      actions: [],
      toolResults: [],
    },
    ...overrides,
  } as AgentActionRecord;
}

describe("MessageHandler", () => {
  const handler = new MessageHandler();
  const baseOptions: BuildContextOptions = {
    selfId: "bot-1",
    channelKey: "test:channel",
  };

  it("renders <msg> tag with id, time, sender, content", async () => {
    const record = createMessageRecord();
    const result = await handler.handle(record, baseOptions);

    expect(result).toHaveLength(1);
    const msg = result[0] as LoopMessage;
    expect(msg.role).toBe("user");
    expect(typeof msg.content).toBe("string");
    expect(msg.content).toMatch(/<msg id="0" time="\d{2}月\d{2}日 \d{2}:\d{2}">/);
    expect(msg.content).toContain("Alice(user-123)");
    expect(msg.content).toContain("Hello world");
    expect(msg.content).toContain("</msg>");
  });

  it("includes [回复: N] when replyTo provided and getShortId returns value", async () => {
    const record = createMessageRecord({
      data: {
        messageId: "msg-2",
        senderId: "user-456",
        senderName: "Bob",
        content: "I agree",
        replyTo: "msg-1",
      },
    });

    const options: BuildContextOptions = {
      ...baseOptions,
      getShortId: (channelKey, msgId) => {
        if (channelKey === "test:channel" && msgId === "msg-1") return 1;
        return undefined;
      },
    };

    const result = await handler.handle(record, options);
    expect(result[0].content).toContain("[回复: 1]");
    expect(result[0].content).toContain("I agree");
  });

  it("returns user role LoopMessage", async () => {
    const record = createMessageRecord();
    const result = await handler.handle(record, baseOptions);

    expect(result[0].role).toBe("user");
  });

  it("assigns short ID using shortIdAssigner", async () => {
    let lastAssignedId = 0;
    const record = createMessageRecord({
      id: "msg-10",
      data: {
        messageId: "native-msg-10",
        senderId: "user-999",
        senderName: "Charlie",
        content: "Test",
      },
    });

    const options: BuildContextOptions = {
      ...baseOptions,
      shortIdAssigner: (_channelKey, _msgId) => {
        lastAssignedId = (lastAssignedId % 10) + 1; // Cycle 1-10
        return lastAssignedId;
      },
    };

    const result = await handler.handle(record, options);
    expect(result[0].content).toContain('<msg id="1"');
  });
});

describe("AgentResponseHandler", () => {
  const handler = new AgentResponseHandler();

  it("returns empty array for successful response with no rawText", async () => {
    const record = createAgentResponseRecord({
      data: { rawText: "" },
    });
    const result = await handler.handle(record, {});

    expect(result).toEqual([]);
  });

  it("returns assistant message for successful response with rawText", async () => {
    const record = createAgentResponseRecord({
      data: { rawText: "This is the response text" },
    });
    const result = await handler.handle(record, {});

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toBe("This is the response text");
  });

  it("returns <error> tag for error response", async () => {
    const record = createAgentResponseRecord({
      data: {
        rawText: "",
        error: "API rate limit exceeded",
      },
    });
    const result = await handler.handle(record, {});

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("<error>");
    expect(result[0].content).toContain("API rate limit exceeded");
    expect(result[0].content).toContain("</error>");
  });

  it("escapes XML special chars in error content", async () => {
    const record = createAgentResponseRecord({
      data: {
        rawText: "",
        error: 'Error: "unexpected" & <tag> in response',
      },
    });
    const result = await handler.handle(record, {});

    expect(result[0].content).toContain("&quot;");
    expect(result[0].content).toContain("&amp;");
    expect(result[0].content).toContain("&lt;");
    expect(result[0].content).toContain("&gt;");
    expect(result[0].content).not.toContain('"');
    expect(result[0].content).not.toContain('&"'); // Check & is escaped (not followed by quot)
    expect(result[0].content).not.toContain("<tag>");
  });
});

describe("AgentActionHandler", () => {
  const handler = new AgentActionHandler();

  it("renders <action> tag with action summaries", async () => {
    const record = createAgentActionRecord({
      data: {
        actions: [
          { name: "search_web", params: { query: "test" } },
          { name: "get_weather", params: { city: "Tokyo" } },
        ],
        toolResults: [],
      },
    });
    const result = await handler.handle(record, {});

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("<action>");
    expect(result[0].content).toContain('search_web({"query":"test"})');
    expect(result[0].content).toContain('get_weather({"city":"Tokyo"})');
    expect(result[0].content).toContain("</action>");
  });

  it("handles send_message specially (shows sent/failed)", async () => {
    const record = createAgentActionRecord({
      data: {
        actions: [],
        toolResults: [
          { name: "send_message", status: "ok", result: "Message sent" },
          { name: "send_message", status: "fulfilled", result: undefined },
          { name: "send_message", status: "failed", error: "Network error" },
        ],
      },
    });
    const result = await handler.handle(record, {});

    expect(result[0].content).toContain("send_message -> sent");
    expect(result[0].content).toContain("send_message -> failed");
  });

  it("treats send_message with success=false as failed even without explicit error", async () => {
    const record = createAgentActionRecord({
      data: {
        actions: [],
        toolResults: [{ name: "send_message", success: false, status: "timeout" }],
      },
    });
    const result = await handler.handle(record, {});

    expect(result[0].content).toContain("send_message -> failed");
  });

  it("shows tool results with preview", async () => {
    const record = createAgentActionRecord({
      data: {
        actions: [],
        toolResults: [
          { name: "get_weather", status: "ok", result: "Sunny, 25°C" },
          { name: "search_web", status: "error", error: "API timeout" },
        ],
      },
    });
    const result = await handler.handle(record, {});

    expect(result[0].content).toContain("get_weather -> ok: Sunny, 25°C");
    // Error status uses error message, not status string
    expect(result[0].content).toContain("search_web -> API timeout");
  });

  it("shows (No actions) when empty", async () => {
    const record = createAgentActionRecord({
      data: {
        actions: [],
        toolResults: [],
      },
    });
    const result = await handler.handle(record, {});

    expect(result).toEqual([]);
  });

  it("truncates long result previews to 100 chars", async () => {
    const longResult = "x".repeat(200);
    const record = createAgentActionRecord({
      data: {
        actions: [],
        toolResults: [{ name: "search_web", status: "ok", result: longResult }],
      },
    });
    const result = await handler.handle(record, {});

    // Should truncate to ~100 chars plus label
    expect(result[0].content).toMatch(/search_web -> ok: x{100}/);
  });
});

describe("buildLoopMessages integration", () => {
  // Mock Context for EventManager - tests only use buildLoopMessages which is a pure function
  const mockContext = {
    logger: () => ({ info: () => {} }),
  } as unknown as Context;

  const eventManager = new EventManager(mockContext);

  it("processes mixed entry types correctly", async () => {
    const messageRecord = createMessageRecord({
      id: "msg-1",
      data: {
        messageId: "native-msg-1",
        senderId: "user-123",
        senderName: "Alice",
        content: "Hello",
      },
    });

    const responseRecord = createAgentResponseRecord({
      id: "resp-1",
      data: { rawText: "Hi there!" },
    });

    const actionRecord = createAgentActionRecord({
      id: "action-1",
      data: {
        actions: [{ name: "test_action", params: {} }],
        toolResults: [],
      },
    });

    const entries = [messageRecord, responseRecord, actionRecord];
    const options: BuildContextOptions = {
      selfId: "bot-1",
      channelKey: "test:channel",
    };

    const result = await eventManager.buildLoopMessages(entries, options);

    // Should have user message (Alice), assistant message (response), user action
    expect(result.length).toBeGreaterThanOrEqual(2);

    // First message should be Alice's user message
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("Alice(user-123)");

    // Should have assistant response
    const assistantMsg = result.find((m: LoopMessage) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.content).toBe("Hi there!");

    // Should have action block
    const actionMsg = result.find(
      (m: LoopMessage) => typeof m.content === "string" && m.content.includes("<action>"),
    );
    expect(actionMsg).toBeDefined();
  });

  it("dispatches handlers by entry type correctly", async () => {
    const messageRecord = createMessageRecord();
    const errorRecord = createAgentResponseRecord({
      data: { rawText: "", error: "Test error" },
    });

    const entries = [messageRecord, errorRecord];
    const options: BuildContextOptions = {
      selfId: "bot-1",
      channelKey: "test:channel",
    };

    const result = await eventManager.buildLoopMessages(entries, options);

    // Both should be user messages (message + error)
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toContain("<msg");
    expect(result[1].role).toBe("user");
    expect(result[1].content).toContain("<error>");
  });
});
