import { describe, it, expect } from "vitest";

import {
  extractSnippet,
  deduplicateResults,
  formatCompactLine,
  formatSearchResults,
} from "../../../../src/extension/chat-history/engine/result-formatter.js";

describe("extractSnippet", () => {
  it("returns full content for short messages", () => {
    const result = extractSnippet("Hello world", "hello");
    expect(result).toBe("Hello world");
  });

  it("extracts snippet around keyword for long messages", () => {
    const longText = "A".repeat(300) + "KEYWORD" + "B".repeat(300);
    const result = extractSnippet(longText, "keyword");
    expect(result).toContain("KEYWORD");
    expect(result.length).toBeLessThanOrEqual(410); // 200 + keyword + 200 + ellipsis
    expect(result.startsWith("…")).toBe(true);
    expect(result.endsWith("…")).toBe(true);
  });

  it("handles keyword at start of long message", () => {
    const longText = "KEYWORD" + "B".repeat(500);
    const result = extractSnippet(longText, "keyword");
    expect(result.startsWith("KEYWORD")).toBe(true);
    expect(result.endsWith("…")).toBe(true);
  });

  it("handles keyword at end of long message", () => {
    const longText = "A".repeat(500) + "KEYWORD";
    const result = extractSnippet(longText, "keyword");
    expect(result.endsWith("KEYWORD")).toBe(true);
    expect(result.startsWith("…")).toBe(true);
  });

  it("returns truncated content when keyword not found in long message", () => {
    const longText = "A".repeat(500);
    const result = extractSnippet(longText, "notfound");
    expect(result.length).toBeLessThanOrEqual(403); // 400 + ellipsis
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("deduplicateResults", () => {
  it("removes consecutive hits within 60s", () => {
    const results = [
      {
        id: "1",
        timestamp: new Date("2026-05-17T10:00:00Z").getTime(),
        role: "user" as const,
        speaker: "Alice",
        content: "a",
        channelKey: "ch1",
      },
      {
        id: "2",
        timestamp: new Date("2026-05-17T10:00:30Z").getTime(),
        role: "user" as const,
        speaker: "Alice",
        content: "b",
        channelKey: "ch1",
      },
      {
        id: "3",
        timestamp: new Date("2026-05-17T10:05:00Z").getTime(),
        role: "user" as const,
        speaker: "Alice",
        content: "c",
        channelKey: "ch1",
      },
    ];
    const { deduped, totalFound } = deduplicateResults(results);
    expect(deduped).toHaveLength(2); // first and third
    expect(totalFound).toBe(3);
  });

  it("does not deduplicate across different channels", () => {
    const results = [
      {
        id: "1",
        timestamp: new Date("2026-05-17T10:00:00Z").getTime(),
        role: "user" as const,
        speaker: "Alice",
        content: "a",
        channelKey: "ch1",
      },
      {
        id: "2",
        timestamp: new Date("2026-05-17T10:00:30Z").getTime(),
        role: "user" as const,
        speaker: "Alice",
        content: "b",
        channelKey: "ch2",
      },
    ];
    const { deduped } = deduplicateResults(results);
    expect(deduped).toHaveLength(2);
  });

  it("returns empty for empty input", () => {
    const { deduped, totalFound } = deduplicateResults([]);
    expect(deduped).toHaveLength(0);
    expect(totalFound).toBe(0);
  });
});

describe("formatCompactLine", () => {
  it("formats user message correctly", () => {
    const line = formatCompactLine(
      {
        timestamp: new Date("2026-05-17T10:01:00Z").getTime(),
        role: "user",
        speaker: "Alice",
        content: "Hello world",
      },
      false,
    );
    expect(line).toMatch(/^\[2026-05-17 \d{2}:01\] user Alice: Hello world$/);
  });

  it("formats assistant message correctly", () => {
    const line = formatCompactLine(
      {
        timestamp: new Date("2026-05-17T10:02:00Z").getTime(),
        role: "assistant",
        speaker: "assistant",
        content: "Hi there",
      },
      false,
    );
    expect(line).toMatch(/^\[2026-05-17 \d{2}:02\] assistant: Hi there$/);
  });

  it("adds anchor prefix", () => {
    const line = formatCompactLine(
      {
        timestamp: new Date("2026-05-17T10:01:00Z").getTime(),
        role: "user",
        speaker: "Alice",
        content: "Hello",
      },
      true,
    );
    expect(line.startsWith(">>> ")).toBe(true);
  });

  it("truncates long content to 1000 chars", () => {
    const line = formatCompactLine(
      {
        timestamp: new Date("2026-05-17T10:01:00Z").getTime(),
        role: "user",
        speaker: "Alice",
        content: "X".repeat(1500),
      },
      false,
    );
    expect(line.length).toBeLessThan(1100);
  });

  it("formats millisecond timestamp correctly", () => {
    const ts = 1779181200000; // 2026-05-19 09:00:00 UTC
    const line = formatCompactLine(
      { timestamp: ts, role: "user", speaker: "Test", content: "msg" },
      false,
    );
    expect(line).toContain("2026-05-19");
  });

  it("formats second-level timestamp correctly after conversion", () => {
    const ts = 1779181200 * 1000; // 秒级转换为毫秒
    const line = formatCompactLine(
      { timestamp: ts, role: "user", speaker: "Test", content: "msg" },
      false,
    );
    expect(line).toContain("2026-05-19");
  });
});

describe("formatSearchResults", () => {
  it("sorts by time descending", () => {
    const results = [
      {
        id: "1",
        timestamp: new Date("2026-05-17T10:00:00Z").getTime(),
        role: "user" as const,
        speaker: "Alice",
        content: "old",
        channelKey: "ch1",
      },
      {
        id: "2",
        timestamp: new Date("2026-05-18T10:00:00Z").getTime(),
        role: "user" as const,
        speaker: "Alice",
        content: "new",
        channelKey: "ch1",
      },
    ];
    const formatted = formatSearchResults(results, "test", 10, false);
    expect(formatted.results[0].id).toBe("2");
  });

  it("includes channel field when showChannel is true", () => {
    const results = [
      {
        id: "1",
        timestamp: new Date("2026-05-17T10:00:00Z").getTime(),
        role: "user" as const,
        speaker: "Alice",
        content: "hi",
        channelKey: "onebot_group-123",
      },
    ];
    const formatted = formatSearchResults(results, "hi", 10, true);
    expect(formatted.results[0].channel).toBeDefined();
  });

  it("respects limit", () => {
    const results = Array.from({ length: 20 }, (_, i) => ({
      id: `${i}`,
      timestamp: new Date(`2026-05-17T10:${String(i).padStart(2, "0")}:00Z`).getTime(),
      role: "user" as const,
      speaker: "Alice",
      content: `msg ${i}`,
      channelKey: "ch1",
    }));
    const formatted = formatSearchResults(results, "msg", 5, false);
    expect(formatted.results).toHaveLength(5);
    expect(formatted.total_found).toBe(20);
  });
});
