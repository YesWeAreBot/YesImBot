import { describe, expect, it } from "vitest";

import {
  estimateContextTokens,
  prepareCompaction,
  serializeSessionMessagesForCompaction,
  shouldCompact,
} from "../../src/services/session/compaction";
import type { SessionMessageEntry } from "../../src/services/session/messages";

function userEntry(id: string, content: string): SessionMessageEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date(1_710_000_000_000).toISOString(),
    message: {
      type: "user.message",
      timestamp: new Date(1_710_000_000_000).toISOString(),
      data: {
        messageId: id,
        senderId: "user-1",
        senderName: "alice",
        content,
      },
    },
  };
}

function assistantEntry(id: string, content: string): SessionMessageEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date(1_710_000_000_001).toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "text", text: content }],
    },
  };
}

describe("compaction", () => {
  it("uses active threshold formula only", () => {
    expect(
      shouldCompact(90_000, 100_000, {
        enabled: true,
        reserveTokens: 20_000,
        keepRecentTokens: 20_000,
      }),
    ).toBe(true);
    expect(
      shouldCompact(50_000, 100_000, {
        enabled: true,
        reserveTokens: 20_000,
        keepRecentTokens: 20_000,
      }),
    ).toBe(false);
  });

  it("prepares compaction from session message entries only", () => {
    const entries = [
      userEntry("u1", "old request"),
      assistantEntry("a1", "old reply"),
      userEntry("u2", "x".repeat(600)),
      assistantEntry("a2", "new reply"),
    ];

    const preparation = prepareCompaction(
      entries,
      {
        enabled: true,
        reserveTokens: 16_384,
        keepRecentTokens: 30,
      },
      "previous summary",
    );

    expect(preparation).toBeDefined();
    expect(preparation?.previousSummary).toBe("previous summary");
    expect(preparation?.firstKeptEntryId).toBe("u2");
    expect(preparation?.entriesToSummarize.map((entry) => entry.id)).toEqual(["u1", "a1"]);
    expect(preparation?.turnPrefixEntries).toEqual([]);
    expect(preparation?.isSplitTurn).toBe(false);
  });

  it("returns undefined when there is no summarizable history", () => {
    const preparation = prepareCompaction(
      [userEntry("u1", "hello"), assistantEntry("a1", "world")],
      {
        enabled: true,
        reserveTokens: 16_384,
        keepRecentTokens: 20_000,
      },
    );

    expect(preparation).toBeUndefined();
  });

  it("serializes session messages for summary without helper entries", () => {
    const text = serializeSessionMessagesForCompaction([
      userEntry("u1", "hello").message,
      assistantEntry("a1", "response").message,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "search",
            output: { type: "text", value: "ok" },
          },
        ],
      },
    ]);

    expect(text).toContain("[User]: hello");
    expect(text).toContain("[Assistant]: response");
    expect(text).toContain("[Tool]:");
    expect(estimateContextTokens([{ role: "user", content: "hello" }])).toBeGreaterThan(0);
  });
});
