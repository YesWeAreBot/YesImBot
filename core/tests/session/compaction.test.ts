import { describe, expect, it } from "vitest";

import {
  estimateContextTokens,
  estimateTokens,
  findCutPoint,
  prepareCompaction,
  serializeConversation,
  shouldCompact,
} from "../../src/services/session/compaction";
import type {
  AgentAssistantMessage,
  AgentCustomMessage,
  AgentMessage,
  AgentToolMessage,
  AgentUserMessage,
  SessionEntry,
} from "../../src/services/session/session-manager/types";

const DEFAULT_COMPACTION_SETTINGS = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

function user(content: string): AgentUserMessage {
  return { role: "user", content, timestamp: Date.now() };
}

function assistant(content: AgentAssistantMessage["content"]): AgentAssistantMessage {
  return {
    role: "assistant",
    content,
    timestamp: Date.now(),
    provider: "test",
    model: "test-model",
  };
}

function toolResult(result: unknown): AgentToolMessage {
  return {
    role: "tool",
    timestamp: Date.now(),
    content: [
      {
        type: "tool-result",
        toolCallId: "tc-1",
        toolName: "search",
        result,
      },
    ],
  };
}

function custom(content: string): AgentCustomMessage {
  return {
    role: "custom",
    customType: "channel_message",
    content,
    display: false,
    timestamp: Date.now(),
  };
}

function messageEntry(id: string, message: AgentMessage): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message,
  };
}

function channelMessageEntry(id: string, content: string): SessionEntry {
  return {
    type: "custom_message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    customType: "channel_message",
    content,
    display: false,
  };
}

function protocolGuidanceEntry(id: string, content: string): SessionEntry {
  return {
    type: "custom_message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    customType: "protocol_guidance",
    content,
    display: false,
  };
}

function controlStateEntry(id: string, content: string): SessionEntry {
  return {
    type: "custom_message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    customType: "control_state",
    content,
    display: false,
  };
}

function protocolDraftEntry(id: string, text: string): SessionEntry {
  return {
    type: "custom",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    customType: "protocol_assistant_draft",
    data: {
      text,
      provider: "test",
      model: "test-model",
    },
  };
}

describe("compaction estimate", () => {
  it("estimates user string message tokens", () => {
    expect(estimateTokens(user("hello world"))).toBe(3);
  });

  it("estimates assistant text-part tokens", () => {
    expect(estimateTokens(assistant([{ type: "text", text: "response text" }]))).toBe(4);
  });

  it("estimates assistant tool-call using tool name plus JSON args", () => {
    const msg = assistant([
      {
        type: "tool-call",
        toolCallId: "tc-1",
        toolName: "search",
        args: { q: "abc" },
      },
    ]);
    const expectedChars = "search".length + JSON.stringify({ q: "abc" }).length;
    expect(estimateTokens(msg)).toBe(Math.ceil(expectedChars / 4));
  });

  it("estimates assistant thinking part tokens", () => {
    expect(estimateTokens(assistant([{ type: "thinking", text: "inner reasoning" }]))).toBe(
      Math.ceil("inner reasoning".length / 4),
    );
  });

  it("estimates tool message tokens from all tool-result contents", () => {
    const msg: AgentToolMessage = {
      role: "tool",
      timestamp: Date.now(),
      content: [
        { type: "tool-result", toolCallId: "1", toolName: "a", result: "ok" },
        { type: "tool-result", toolCallId: "2", toolName: "b", result: { v: 1 } },
      ],
    };
    const chars = JSON.stringify("ok").length + JSON.stringify({ v: 1 }).length;
    expect(estimateTokens(msg)).toBe(Math.ceil(chars / 4));
  });

  it("estimates custom string message tokens", () => {
    expect(estimateTokens(custom("[alice]: hi"))).toBe(Math.ceil("[alice]: hi".length / 4));
  });

  it("prefers assistant usage.inputTokens and adds trailing estimates", () => {
    const messages: AgentMessage[] = [
      user("12345678"),
      {
        ...assistant("done"),
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
        },
      },
      user("abcd"),
    ];
    expect(estimateContextTokens(messages)).toBe(101);
  });

  it("ignores zeroed usage records and falls back to heuristic estimation", () => {
    const messages: AgentMessage[] = [
      user("12345678"),
      {
        ...assistant("done"),
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      },
    ];

    expect(estimateContextTokens(messages)).toBe(3);
  });
});

describe("compaction trigger", () => {
  it("uses D-01 threshold formula", () => {
    const settings = DEFAULT_COMPACTION_SETTINGS;
    expect(shouldCompact(90000, 100000, settings)).toBe(true);
    expect(shouldCompact(50000, 100000, settings)).toBe(false);
  });

  it("returns false when disabled", () => {
    expect(
      shouldCompact(90000, 100000, {
        ...DEFAULT_COMPACTION_SETTINGS,
        enabled: false,
      }),
    ).toBe(false);
  });
});

describe("cut point detection", () => {
  it("never returns a cut point that starts at a tool message", () => {
    const entries: SessionEntry[] = [
      messageEntry("m1", user("u1")),
      messageEntry("m2", assistant([{ type: "text", text: "a1" }])),
      messageEntry("m3", toolResult("result-1")),
      messageEntry("m4", assistant([{ type: "text", text: "a2" }])),
      messageEntry("m5", toolResult("result-2")),
    ];

    const result = findCutPoint(entries, 0, entries.length, 3);
    const cutEntry = entries[result.firstKeptEntryIndex];
    expect(cutEntry.type).toBe("message");
    if (cutEntry.type === "message") {
      expect(cutEntry.message.role).not.toBe("tool");
    }
  });

  it("treats custom_message as a valid cut point", () => {
    const entries: SessionEntry[] = [
      messageEntry("m1", user("hello")),
      channelMessageEntry("c1", "alice: update"),
      messageEntry("m2", assistant([{ type: "text", text: "ack" }])),
    ];

    const result = findCutPoint(entries, 0, entries.length, 2);
    expect(entries[result.firstKeptEntryIndex]?.id).toBe("c1");
  });

  it("detects split turn when one large turn exceeds keepRecentTokens", () => {
    const entries: SessionEntry[] = [
      messageEntry("u1", user("request")),
      messageEntry("a1", assistant([{ type: "text", text: "x".repeat(120) }])),
      messageEntry("t1", toolResult("y".repeat(120))),
      messageEntry("a2", assistant([{ type: "text", text: "z".repeat(120) }])),
    ];

    const result = findCutPoint(entries, 0, entries.length, 40);
    expect(result.isSplitTurn).toBe(true);
    expect(result.turnStartIndex).toBe(0);
  });
});

describe("conversation serialization", () => {
  it("serializes message types with required labels", () => {
    const toolLong = "x".repeat(2200);
    const messages: AgentMessage[] = [
      user("hi"),
      assistant([
        { type: "thinking", text: "think" },
        { type: "text", text: "response" },
        { type: "tool-call", toolCallId: "tc-1", toolName: "search", args: { q: "v" } },
      ]),
      toolResult(toolLong),
      {
        role: "custom",
        customType: "channel_message",
        content: "alice: hello",
        display: false,
        timestamp: Date.now(),
      },
    ];

    const text = serializeConversation(messages);
    expect(text).toContain("[User]: hi");
    expect(text).toContain("[Assistant]: response");
    expect(text).toContain('[Assistant tool calls]: search(q="v")');
    expect(text).toContain("[Tool result]:");
    expect(text).toContain("[... 200 more characters truncated]");
    expect(text).toContain("[Channel message] alice: hello");
  });

  it("does not serialize protocol/control custom messages", () => {
    const text = serializeConversation([
      {
        role: "custom",
        customType: "protocol_guidance",
        content: "Visible IM replies must be sent with send_message",
        display: false,
        timestamp: Date.now(),
      },
      {
        role: "custom",
        customType: "control_state",
        content: "internal",
        display: false,
        timestamp: Date.now(),
      },
      {
        role: "custom",
        customType: "channel_message",
        content: "alice: hello",
        display: false,
        timestamp: Date.now(),
      },
    ]);

    expect(text).toContain("[Channel message] alice: hello");
    expect(text).not.toContain("[protocol_guidance]");
    expect(text).not.toContain("[control_state]");
  });
});

describe("prepareCompaction", () => {
  it("returns undefined when the last entry is already a compaction", () => {
    const entries: SessionEntry[] = [
      messageEntry("u1", user("hello")),
      {
        type: "compaction",
        id: "cmp1",
        parentId: "u1",
        timestamp: new Date().toISOString(),
        summary: "s",
        firstKeptEntryId: "u1",
        tokensBefore: 10,
      },
    ];

    expect(prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS)).toBeUndefined();
  });

  it("splits messagesToSummarize and carries previousSummary", () => {
    const entries: SessionEntry[] = [
      messageEntry("u1", user("before compaction")),
      {
        type: "compaction",
        id: "cmp1",
        parentId: "u1",
        timestamp: new Date().toISOString(),
        summary: "previous summary",
        firstKeptEntryId: "k1",
        tokensBefore: 20,
      },
      messageEntry("k1", user("old recent message")),
      messageEntry("k2", assistant([{ type: "text", text: "old assistant" }])),
      messageEntry("k3", user("x".repeat(400))),
      messageEntry("k4", assistant([{ type: "text", text: "newest" }])),
    ];

    const preparation = prepareCompaction(entries, {
      ...DEFAULT_COMPACTION_SETTINGS,
      keepRecentTokens: 30,
    });

    expect(preparation).toBeDefined();
    expect(preparation?.previousSummary).toBe("previous summary");
    expect(preparation?.messagesToSummarize.length).toBeGreaterThan(0);
    expect(preparation?.firstKeptEntryId).toBe("k3");
  });

  it("scales keepRecentTokens using larger real contextTokens", () => {
    const entries: SessionEntry[] = [
      messageEntry("u1", user("u".repeat(4000))),
      messageEntry("a1", assistant([{ type: "text", text: "a".repeat(4000) }])),
      messageEntry("u2", user("u".repeat(4000))),
      messageEntry("a2", assistant([{ type: "text", text: "a".repeat(4000) }])),
      messageEntry("u3", user("u".repeat(4000))),
      messageEntry("a3", assistant([{ type: "text", text: "a".repeat(4000) }])),
    ];

    const withoutScaling = prepareCompaction(entries, {
      ...DEFAULT_COMPACTION_SETTINGS,
      keepRecentTokens: 20000,
    });
    expect(withoutScaling?.messagesToSummarize.length ?? 0).toBe(0);

    const withScaling = prepareCompaction(
      entries,
      {
        ...DEFAULT_COMPACTION_SETTINGS,
        keepRecentTokens: 20000,
      },
      120000,
    );

    expect(withScaling).toBeDefined();
    expect(withScaling?.messagesToSummarize.length).toBeGreaterThan(0);
    expect(withScaling?.firstKeptEntryId).not.toBe(entries[0].id);
  });

  it("returns undefined when no summarizable history and no previous summary", () => {
    const entries: SessionEntry[] = [
      messageEntry("u1", user("hello")),
      messageEntry("a1", assistant([{ type: "text", text: "world" }])),
    ];

    const preparation = prepareCompaction(entries, {
      ...DEFAULT_COMPACTION_SETTINGS,
      keepRecentTokens: 20000,
    });

    expect(preparation).toBeUndefined();
  });

  it("excludes protocol_guidance from compaction input", () => {
    const entries: SessionEntry[] = [
      messageEntry("u1", user("hello")),
      protocolGuidanceEntry("p1", "Visible IM replies must be sent with the send_message tool"),
      messageEntry("a1", assistant([{ type: "text", text: "world" }])),
      messageEntry("u2", user("x".repeat(400))),
      messageEntry("a2", assistant([{ type: "text", text: "newest" }])),
    ];

    const preparation = prepareCompaction(entries, {
      ...DEFAULT_COMPACTION_SETTINGS,
      keepRecentTokens: 30,
    });

    expect(preparation).toBeDefined();
    expect(preparation?.messagesToSummarize).toEqual([
      expect.objectContaining({ role: "user", content: "hello" }),
      expect.objectContaining({ role: "assistant" }),
    ]);
    expect(
      preparation?.messagesToSummarize.some(
        (message) => message.role === "custom" && message.customType === "protocol_guidance",
      ),
    ).toBe(false);
  });

  it("excludes control_state from compaction input", () => {
    const entries: SessionEntry[] = [
      messageEntry("u1", user("hello")),
      controlStateEntry("c1", "internal"),
      messageEntry("a1", assistant([{ type: "text", text: "world" }])),
      messageEntry("u2", user("x".repeat(400))),
      messageEntry("a2", assistant([{ type: "text", text: "newest" }])),
    ];

    const preparation = prepareCompaction(entries, {
      ...DEFAULT_COMPACTION_SETTINGS,
      keepRecentTokens: 30,
    });

    expect(preparation).toBeDefined();
    expect(
      preparation?.messagesToSummarize.some(
        (message) => message.role === "custom" && message.customType === "control_state",
      ),
    ).toBe(false);
  });

  it("excludes protocol assistant drafts from compaction input", () => {
    const entries: SessionEntry[] = [
      messageEntry("u1", user("hello")),
      protocolDraftEntry("d1", "undelivered plain text"),
      messageEntry("a1", assistant([{ type: "text", text: "world" }])),
      messageEntry("u2", user("x".repeat(400))),
      messageEntry("a2", assistant([{ type: "text", text: "newest" }])),
    ];

    const preparation = prepareCompaction(entries, {
      ...DEFAULT_COMPACTION_SETTINGS,
      keepRecentTokens: 30,
    });

    expect(preparation).toBeDefined();
    expect(preparation?.messagesToSummarize).toEqual([
      expect.objectContaining({ role: "user", content: "hello" }),
      expect.objectContaining({ role: "assistant" }),
    ]);
  });
});
