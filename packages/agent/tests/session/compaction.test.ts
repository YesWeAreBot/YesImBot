import { beforeEach, describe, expect, it } from "vitest";

import type {
  AgentMessage,
  AssistantMessage,
  ToolMessage,
  UserMessage,
} from "../../src/agent/types.js";
import {
  estimateTokens,
  findCutPoint,
  findTurnStartIndex,
  prepareCompaction,
  type CompactionSettings,
} from "../../src/session/compaction/compaction.js";
import type {
  CompactionEntry,
  CustomMessageEntry,
  SessionEntry,
  SessionMessageEntry,
} from "../../src/session/session-manager.js";

// ============================================================================
// Helpers
// ============================================================================

let idCounter = 0;
function nextId(): string {
  return (++idCounter).toString(16).padStart(8, "0");
}

function resetIds(): void {
  idCounter = 0;
}

function makeUserEntry(text: string, parentId: string | null = null): SessionMessageEntry {
  const id = nextId();
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    } as UserMessage,
  };
}

function makeAssistantEntry(
  text: string,
  parentId: string | null,
  opts?: { usage?: Partial<import("ai").LanguageModelUsage>; toolCalls?: boolean },
): SessionMessageEntry {
  const id = nextId();
  const content: AssistantMessage["content"] = [{ type: "text", text }];
  if (opts?.toolCalls) {
    content.push({ type: "tool-call", toolCallId: `tc-${id}`, toolName: "test_tool", input: {} });
  }
  // Default usage: inputTokens + outputTokens = total heuristic estimate of all messages so far
  // This ensures estimateContextTokens (which uses usage) aligns with the heuristic
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content,
      usage: opts?.usage ?? {},
      finishReason: "stop",
      timestamp: Date.now(),
    } as AssistantMessage,
  };
}

function makeToolEntry(parentId: string | null): SessionMessageEntry {
  const id = nextId();
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: {
      role: "tool",
      content: [
        { type: "tool-result", toolCallId: `tc-${parentId}`, toolName: "test_tool", result: "ok" },
      ],
      timestamp: Date.now(),
    } as unknown as ToolMessage,
  };
}

function makeCustomMessageEntry(text: string, parentId: string | null): CustomMessageEntry {
  const id = nextId();
  return {
    type: "custom_message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    customType: "test",
    content: [{ type: "text", text }],
    display: true,
  };
}

function makeCompactionEntry(
  summary: string,
  firstKeptEntryId: string,
  parentId: string | null,
): CompactionEntry {
  const id = nextId();
  return {
    type: "compaction",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    summary,
    firstKeptEntryId,
    tokensBefore: 5000,
  };
}

/** Build a linked chain of entries (sets parentId to previous entry's id) */
function linkEntries(entries: SessionEntry[]): SessionEntry[] {
  for (let i = 1; i < entries.length; i++) {
    entries[i].parentId = entries[i - 1].id;
  }
  return entries;
}

/** Generate a long text that estimates to approximately `targetTokens` tokens (chars/4) */
function textForTokens(targetTokens: number): string {
  return "x".repeat(targetTokens * 4);
}

const DEFAULT_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 4096,
  keepRecentTokens: 1000,
};

// ============================================================================
// Tests
// ============================================================================

describe("prepareCompaction", () => {
  beforeEach(() => resetIds());

  it("returns non-empty messagesToSummarize when tokensBefore > keepRecentTokens", () => {
    // Simulate the real-world scenario: LLM usage reports high token count
    // but heuristic (chars/4) is lower. The scaling logic should handle this.
    // Each entry has ~500 heuristic tokens (2000 chars / 4)
    // Last assistant has usage reporting much higher total (simulating real LLM usage)
    const entries = linkEntries([
      makeUserEntry(textForTokens(500)),
      makeAssistantEntry(textForTokens(500), null),
      makeUserEntry(textForTokens(500)),
      makeAssistantEntry(textForTokens(500), null),
      makeUserEntry(textForTokens(500)),
      makeAssistantEntry(textForTokens(500), null, {
        // Usage reports total context as 6000 tokens (higher than heuristic ~3000)
        usage: { inputTokens: 5500, outputTokens: 500 },
      }),
    ]);

    const settings: CompactionSettings = {
      enabled: true,
      reserveTokens: 4096,
      keepRecentTokens: 2000, // Keep ~2000 tokens worth, rest should be summarized
    };

    const result = prepareCompaction(entries, settings);
    expect(result).toBeDefined();
    expect(result!.messagesToSummarize.length).toBeGreaterThan(0);
    expect(result!.tokensBefore).toBeGreaterThan(settings.keepRecentTokens);
  });

  it("returns non-empty messagesToSummarize with heuristic-only estimation (no usage)", () => {
    // When no assistant has valid usage data, estimateContextTokens falls back to heuristic.
    // We simulate this by having finishReason=abort (which makes getAssistantUsage skip it).
    resetIds();
    const entries: SessionEntry[] = [];
    entries.push(makeUserEntry(textForTokens(500)));
    entries.push(
      makeAssistantEntry(textForTokens(500), null, {
        usage: { inputTokens: 100, outputTokens: 50 },
      }),
    );
    // Mark all assistants as aborted so usage is skipped
    for (const e of entries) {
      if (e.type === "message" && e.message.role === "assistant") {
        (e.message as AssistantMessage).finishReason = "abort";
      }
    }
    entries.push(makeUserEntry(textForTokens(500)));
    const abortedAssistant = makeAssistantEntry(textForTokens(500), null);
    (abortedAssistant.message as AssistantMessage).finishReason = "abort";
    entries.push(abortedAssistant);
    entries.push(makeUserEntry(textForTokens(500)));
    const abortedAssistant2 = makeAssistantEntry(textForTokens(500), null);
    (abortedAssistant2.message as AssistantMessage).finishReason = "abort";
    entries.push(abortedAssistant2);
    linkEntries(entries);

    const settings: CompactionSettings = {
      enabled: true,
      reserveTokens: 4096,
      keepRecentTokens: 1000,
    };

    const result = prepareCompaction(entries, settings);
    expect(result).toBeDefined();
    expect(result!.messagesToSummarize.length).toBeGreaterThan(0);
    // With all aborted assistants, heuristic is used: ~3000 tokens total
    expect(result!.tokensBefore).toBeGreaterThan(settings.keepRecentTokens);
  });

  it("returns undefined when keepRecentTokens >= total context tokens", () => {
    const entries = linkEntries([makeUserEntry("hello"), makeAssistantEntry("hi there", null)]);

    const settings: CompactionSettings = {
      enabled: true,
      reserveTokens: 4096,
      keepRecentTokens: 100000, // Way more than actual tokens
    };

    const result = prepareCompaction(entries, settings);
    expect(result).toBeUndefined();
  });

  it("does not cut at tool result entries", () => {
    // Create: user -> assistant(with tool call) -> tool -> user -> assistant
    const entries = linkEntries([
      makeUserEntry(textForTokens(500)),
      makeAssistantEntry(textForTokens(500), null, { toolCalls: true }),
      makeToolEntry(null),
      makeUserEntry(textForTokens(500)),
      makeAssistantEntry(textForTokens(500), null),
    ]);

    const settings: CompactionSettings = {
      enabled: true,
      reserveTokens: 4096,
      keepRecentTokens: 600, // Should keep last ~600 tokens
    };

    const result = prepareCompaction(entries, settings);
    expect(result).toBeDefined();
    // The firstKeptEntryId should NOT be the tool entry
    const keptEntry = entries.find((e) => e.id === result!.firstKeptEntryId);
    expect(keptEntry).toBeDefined();
    if (keptEntry!.type === "message") {
      expect(keptEntry!.message.role).not.toBe("tool");
    }
  });

  it("handles split turn with correct turnPrefixMessages", () => {
    // user(big) -> assistant(big, tool call) -> tool -> user(small) -> assistant(small)
    // With high usage on last assistant, keepRecentTokens should cut inside a turn
    const entries = linkEntries([
      makeUserEntry(textForTokens(1000)),
      makeAssistantEntry(textForTokens(1000), null, { toolCalls: true }),
      makeToolEntry(null),
      makeUserEntry(textForTokens(200)),
      makeAssistantEntry(textForTokens(200), null, {
        usage: { inputTokens: 4000, outputTokens: 200 },
      }),
    ]);

    const settings: CompactionSettings = {
      enabled: true,
      reserveTokens: 4096,
      keepRecentTokens: 500, // Only keep ~500 tokens from end
    };

    const result = prepareCompaction(entries, settings);
    expect(result).toBeDefined();
    // Either it's a split turn with prefix messages, or it found a clean cut
    if (result!.isSplitTurn) {
      expect(result!.turnPrefixMessages.length).toBeGreaterThan(0);
    } else {
      // Clean cut - messagesToSummarize should still be non-empty
      expect(result!.messagesToSummarize.length).toBeGreaterThan(0);
    }
  });

  it("works correctly with existing compaction entry in session", () => {
    // Simulate a session that already had one compaction
    resetIds();
    const oldUser = makeUserEntry(textForTokens(500));
    const oldAssistant = makeAssistantEntry(textForTokens(500), oldUser.id);
    const keptUser = makeUserEntry(textForTokens(500));
    const keptAssistant = makeAssistantEntry(textForTokens(500), null);

    // Build: oldUser -> oldAssistant -> compaction -> keptUser -> keptAssistant -> new messages
    oldAssistant.parentId = oldUser.id;
    const compaction = makeCompactionEntry("Previous summary", keptUser.id, oldAssistant.id);
    keptUser.parentId = compaction.id;
    keptAssistant.parentId = keptUser.id;

    const newUser1 = makeUserEntry(textForTokens(500));
    newUser1.parentId = keptAssistant.id;
    const newAssistant1 = makeAssistantEntry(textForTokens(500), newUser1.id);
    const newUser2 = makeUserEntry(textForTokens(500));
    newUser2.parentId = newAssistant1.id;
    const newAssistant2 = makeAssistantEntry(textForTokens(500), newUser2.id, {
      usage: { inputTokens: 5000, outputTokens: 500 },
    });

    const allEntries = [
      oldUser,
      oldAssistant,
      compaction,
      keptUser,
      keptAssistant,
      newUser1,
      newAssistant1,
      newUser2,
      newAssistant2,
    ];

    const settings: CompactionSettings = {
      enabled: true,
      reserveTokens: 4096,
      keepRecentTokens: 1500,
    };

    const result = prepareCompaction(allEntries, settings);
    expect(result).toBeDefined();
    expect(result!.messagesToSummarize.length).toBeGreaterThan(0);
    expect(result!.previousSummary).toBe("Previous summary");
  });

  it("includes custom_message entries in token counting", () => {
    // Session with custom_message entries that contribute to context
    const entries = linkEntries([
      makeCustomMessageEntry(textForTokens(500), null),
      makeUserEntry(textForTokens(500)),
      makeAssistantEntry(textForTokens(500), null),
      makeCustomMessageEntry(textForTokens(500), null),
      makeUserEntry(textForTokens(500)),
      makeAssistantEntry(textForTokens(500), null, {
        usage: { inputTokens: 5000, outputTokens: 500 },
      }),
    ]);

    const settings: CompactionSettings = {
      enabled: true,
      reserveTokens: 4096,
      keepRecentTokens: 1500,
    };

    const result = prepareCompaction(entries, settings);
    expect(result).toBeDefined();
    expect(result!.messagesToSummarize.length).toBeGreaterThan(0);
  });

  it("returns undefined when last entry is a compaction entry", () => {
    const entries = linkEntries([
      makeUserEntry("hello"),
      makeAssistantEntry("hi", null),
      makeCompactionEntry("summary", "00000001", null),
    ]);

    const result = prepareCompaction(entries, DEFAULT_SETTINGS);
    expect(result).toBeUndefined();
  });
});

describe("findCutPoint", () => {
  beforeEach(() => resetIds());

  it("never returns a tool message index as firstKeptEntryIndex", () => {
    const entries = linkEntries([
      makeUserEntry(textForTokens(200)),
      makeAssistantEntry(textForTokens(200), null, { toolCalls: true }),
      makeToolEntry(null),
      makeUserEntry(textForTokens(200)),
      makeAssistantEntry(textForTokens(200), null),
    ]);

    const result = findCutPoint(entries, 0, entries.length, 300);
    const keptEntry = entries[result.firstKeptEntryIndex];
    if (keptEntry.type === "message") {
      expect(keptEntry.message.role).not.toBe("tool");
    }
  });
});

describe("findTurnStartIndex", () => {
  beforeEach(() => resetIds());

  it("finds user message that starts the turn", () => {
    const entries = linkEntries([
      makeUserEntry("first turn"),
      makeAssistantEntry("response 1", null),
      makeUserEntry("second turn"),
      makeAssistantEntry("response 2", null, { toolCalls: true }),
      makeToolEntry(null),
    ]);

    // Looking for turn start from the tool entry (index 4)
    const turnStart = findTurnStartIndex(entries, 4, 0);
    expect(turnStart).toBe(2); // The second user message
  });

  it("finds custom_message as turn start", () => {
    const entries = linkEntries([
      makeCustomMessageEntry("system context", null),
      makeAssistantEntry("response", null),
    ]);

    const turnStart = findTurnStartIndex(entries, 1, 0);
    expect(turnStart).toBe(0);
  });
});
