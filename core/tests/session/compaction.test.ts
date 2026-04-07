import type { ModelMessage } from "@ai-sdk/provider-utils";
import { describe, expect, it } from "vitest";

import {
  estimateContextTokens,
  estimateTokens,
  findCutPoint,
  prepareCompaction,
  serializeConversation,
  shouldCompact,
} from "../../src/services/session/compaction/index.ts";
import { serializeTimelineForCompaction } from "../../src/services/session/compaction/serialize";
import type { TimelineRecord } from "../../src/services/session/contracts";
import {
  AgentAssistantMessage,
  AgentCustomMessage,
  AgentMessage,
  AgentToolMessage,
  AgentUserMessage,
} from "../../src/services/session/session-manager";

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

function channelMessageRecord(id: string, content: string): TimelineRecord {
  return {
    id,
    kind: "channel_message",
    timestamp: Date.now(),
    stage: "persisted",
    visibility: "model",
    materialization: "default",
    message: {
      kind: "channel_message",
      platform: "test",
      channelId: "c1",
      messageId: id,
      timestamp: Date.now(),
      content,
      sender: {
        userId: "u1",
        username: "alice",
        nickname: "Alice",
      },
      isDirect: false,
      atSelf: false,
      isReplyToBot: false,
    },
  };
}

function assistantRecord(id: string, content: AgentAssistantMessage["content"]): TimelineRecord {
  return {
    id,
    kind: "assistant_message",
    timestamp: Date.now(),
    stage: "runtime",
    visibility: "model",
    materialization: "default",
    message: {
      role: "assistant",
      content,
      timestamp: Date.now(),
      provider: "test",
      model: "test-model",
    },
  };
}

function toolRecord(id: string, result: unknown): TimelineRecord {
  return {
    id,
    kind: "tool_message",
    timestamp: Date.now(),
    stage: "runtime",
    visibility: "model",
    materialization: "default",
    message: {
      role: "tool",
      timestamp: Date.now(),
      content: [
        {
          type: "tool-result",
          toolCallId: `${id}-tool-call`,
          toolName: "search",
          result,
        },
      ],
    },
  };
}

function hiddenSystemNoticeRecord(id: string, notice: string): TimelineRecord {
  return {
    id,
    kind: "system_notice",
    timestamp: Date.now(),
    stage: "runtime",
    visibility: "hidden",
    materialization: "hidden",
    subType: "protocol_guidance",
    materializationKey: "protocol_guidance",
    notice,
  };
}

function internalStateRecord(id: string, stateType: string): TimelineRecord {
  return {
    id,
    kind: "state_change",
    timestamp: Date.now(),
    stage: "runtime",
    visibility: "internal",
    materialization: "internal",
    stateType,
    data: { source: "test" },
  };
}

describe("compaction estimate", () => {
  it("estimates canonical materialized model messages across system user assistant and tool roles", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "system context" },
      { role: "user", content: "hello world" },
      { role: "assistant", content: "assistant reply" },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc-1",
            toolName: "search",
            result: { ok: true },
          },
        ],
      },
    ];

    const expectedTokens =
      Math.ceil("system context".length / 4) +
      Math.ceil("hello world".length / 4) +
      Math.ceil("assistant reply".length / 4) +
      Math.ceil(JSON.stringify({ ok: true }).length / 4);

    expect(estimateContextTokens(messages as never)).toBe(expectedTokens);
  });

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
    const records: TimelineRecord[] = [
      channelMessageRecord("m1", "u1"),
      assistantRecord("m2", [{ type: "text", text: "a1" }]),
      toolRecord("m3", "result-1"),
      assistantRecord("m4", [{ type: "text", text: "a2" }]),
      toolRecord("m5", "result-2"),
    ];

    const result = findCutPoint(records, 0, records.length, 3);
    expect(records[result.firstKeptRecordIndex]?.kind).not.toBe("tool_message");
  });

  it("treats channel_message as a valid cut point", () => {
    const records: TimelineRecord[] = [
      channelMessageRecord("m1", "hello"),
      channelMessageRecord("c1", "alice: update"),
      assistantRecord("m2", [{ type: "text", text: "ack" }]),
    ];

    const result = findCutPoint(records, 0, records.length, 2);
    expect(records[result.firstKeptRecordIndex]?.id).toBe("c1");
  });

  it("detects split turn when one large turn exceeds keepRecentTokens", () => {
    const records: TimelineRecord[] = [
      channelMessageRecord("u1", "request"),
      assistantRecord("a1", [{ type: "text", text: "x".repeat(120) }]),
      toolRecord("t1", "y".repeat(120)),
      assistantRecord("a2", [{ type: "text", text: "z".repeat(120) }]),
    ];

    const result = findCutPoint(records, 0, records.length, 40);
    expect(result.isSplitTurn).toBe(true);
    expect(result.turnStartIndex).toBe(0);
  });
});

describe("conversation serialization", () => {
  it("serializes canonical timeline records using materialization visibility rules", () => {
    const visibleNotice: TimelineRecord = {
      id: "notice-1",
      kind: "system_notice",
      timestamp: Date.now(),
      stage: "runtime",
      visibility: "model",
      materialization: "subtype",
      subType: "visible_notice",
      materializationKey: "visible_notice",
      notice: "Visible notice",
    };

    const text = serializeTimelineForCompaction(
      [
        channelMessageRecord("u1", "hello"),
        hiddenSystemNoticeRecord("n1", "hidden guidance"),
        internalStateRecord("s1", "follow_up_review"),
        visibleNotice,
        assistantRecord("a1", [{ type: "text", text: "response" }]),
        toolRecord("t1", { answer: 42 }),
      ],
      {
        systemNoticeStrategies: {
          visible_notice: (record) => ({ role: "system", content: record.notice }),
        },
      },
    );

    expect(text).toContain("[User]:");
    expect(text).toContain("hello");
    expect(text).toContain("[System]: Visible notice");
    expect(text).toContain("[Assistant]: response");
    expect(text).toContain("[Tool]:");
    expect(text).not.toContain("hidden guidance");
    expect(text).not.toContain("follow_up_review");
  });

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
  it("prepareCompaction only accepts canonical timeline records and keeps previous summary boundary", () => {
    const records: TimelineRecord[] = [
      channelMessageRecord("k1", "old recent message"),
      assistantRecord("k2", [{ type: "text", text: "old assistant" }]),
      channelMessageRecord("k3", "x".repeat(400)),
      assistantRecord("k4", [{ type: "text", text: "newest" }]),
    ];

    const preparation = prepareCompaction(
      records,
      {
        ...DEFAULT_COMPACTION_SETTINGS,
        keepRecentTokens: 30,
      },
      "previous summary",
    );

    expect(preparation).toBeDefined();
    expect(preparation?.previousSummary).toBe("previous summary");
    expect(preparation?.firstKeptEntryId).toBe("k3");
    expect(preparation).toHaveProperty("recordsToSummarize");
    expect(preparation).toHaveProperty("turnPrefixRecords");
  });

  it("prepareCompaction only keeps model-visible canonical records in summarize and split-turn slices", () => {
    const records: TimelineRecord[] = [
      channelMessageRecord("u1", "request"),
      hiddenSystemNoticeRecord("n1", "hidden guidance"),
      internalStateRecord("s1", "follow_up_review"),
      assistantRecord("a1", [{ type: "text", text: "x".repeat(120) }]),
      toolRecord("t1", "y".repeat(120)),
      assistantRecord("a2", [{ type: "text", text: "z".repeat(120) }]),
    ];

    const preparation = prepareCompaction(
      records,
      {
        ...DEFAULT_COMPACTION_SETTINGS,
        keepRecentTokens: 40,
      },
      undefined,
      120,
    );

    expect(preparation).toBeDefined();
    expect(preparation?.isSplitTurn).toBe(true);
    expect(preparation?.turnPrefixRecords.map((record) => record.id)).toEqual(["u1", "a1", "t1"]);
    expect(preparation?.recordsToSummarize.map((record) => record.id)).not.toContain("n1");
    expect(preparation?.recordsToSummarize.map((record) => record.id)).not.toContain("s1");
  });

  it("splits messagesToSummarize and carries previousSummary", () => {
    const records: TimelineRecord[] = [
      channelMessageRecord("k1", "old recent message"),
      assistantRecord("k2", [{ type: "text", text: "old assistant" }]),
      channelMessageRecord("k3", "x".repeat(400)),
      assistantRecord("k4", [{ type: "text", text: "newest" }]),
    ];

    const preparation = prepareCompaction(
      records,
      {
        ...DEFAULT_COMPACTION_SETTINGS,
        keepRecentTokens: 30,
      },
      "previous summary",
    );

    expect(preparation).toBeDefined();
    expect(preparation?.previousSummary).toBe("previous summary");
    expect(preparation?.recordsToSummarize.length).toBeGreaterThan(0);
    expect(preparation?.firstKeptEntryId).toBe("k3");

    const summaryText = serializeTimelineForCompaction(preparation?.recordsToSummarize ?? []);
    expect(summaryText).toContain("[User]:");
    expect(summaryText).toContain("old recent message");
    expect(summaryText).toContain("[Assistant]: old assistant");
  });

  it("scales keepRecentTokens using larger real contextTokens", () => {
    const records: TimelineRecord[] = [
      channelMessageRecord("u1", "u".repeat(4000)),
      assistantRecord("a1", [{ type: "text", text: "a".repeat(4000) }]),
      channelMessageRecord("u2", "u".repeat(4000)),
      assistantRecord("a2", [{ type: "text", text: "a".repeat(4000) }]),
      channelMessageRecord("u3", "u".repeat(4000)),
      assistantRecord("a3", [{ type: "text", text: "a".repeat(4000) }]),
    ];

    const withoutScaling = prepareCompaction(records, {
      ...DEFAULT_COMPACTION_SETTINGS,
      keepRecentTokens: 20000,
    });
    expect(withoutScaling?.recordsToSummarize.length ?? 0).toBe(0);

    const withScaling = prepareCompaction(
      records,
      {
        ...DEFAULT_COMPACTION_SETTINGS,
        keepRecentTokens: 20000,
      },
      undefined,
      120000,
    );

    expect(withScaling).toBeDefined();
    expect(withScaling?.recordsToSummarize.length).toBeGreaterThan(0);
    expect(withScaling?.firstKeptEntryId).not.toBe(records[0].id);
  });

  it("returns undefined when no summarizable history and no previous summary", () => {
    const records: TimelineRecord[] = [
      channelMessageRecord("u1", "hello"),
      assistantRecord("a1", [{ type: "text", text: "world" }]),
    ];

    const preparation = prepareCompaction(records, {
      ...DEFAULT_COMPACTION_SETTINGS,
      keepRecentTokens: 20000,
    });

    expect(preparation).toBeUndefined();
  });

  it("excludes hidden protocol guidance from compaction input", () => {
    const records: TimelineRecord[] = [
      channelMessageRecord("u1", "hello"),
      hiddenSystemNoticeRecord("p1", "Visible IM replies must be sent with the send_message tool"),
      assistantRecord("a1", [{ type: "text", text: "world" }]),
      channelMessageRecord("u2", "x".repeat(400)),
      assistantRecord("a2", [{ type: "text", text: "newest" }]),
    ];

    const preparation = prepareCompaction(records, {
      ...DEFAULT_COMPACTION_SETTINGS,
      keepRecentTokens: 30,
    });

    expect(preparation).toBeDefined();
    expect(preparation?.recordsToSummarize.map((record) => record.id)).toEqual(["u1", "a1"]);
  });

  it("excludes internal state changes from compaction input", () => {
    const records: TimelineRecord[] = [
      channelMessageRecord("u1", "hello"),
      internalStateRecord("c1", "control_state"),
      assistantRecord("a1", [{ type: "text", text: "world" }]),
      channelMessageRecord("u2", "x".repeat(400)),
      assistantRecord("a2", [{ type: "text", text: "newest" }]),
    ];

    const preparation = prepareCompaction(records, {
      ...DEFAULT_COMPACTION_SETTINGS,
      keepRecentTokens: 30,
    });

    expect(preparation).toBeDefined();
    expect(preparation?.recordsToSummarize.map((record) => record.id)).toEqual(["u1", "a1"]);
  });
});
