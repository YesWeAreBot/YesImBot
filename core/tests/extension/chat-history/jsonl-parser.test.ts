import { join } from "node:path";

// core/tests/extension/chat-history/jsonl-parser.test.ts
import { describe, it, expect } from "vitest";

import { parseJsonlLine, scanJsonlFile } from "../../../src/extension/chat-history/jsonl-parser.js";
import { FIXTURE_DIR } from "./fixtures/helpers.js";

describe("parseJsonlLine", () => {
  it("parses athena:event (custom_message) correctly", () => {
    const line = JSON.stringify({
      type: "custom_message",
      id: "msg-001",
      customType: "athena:event",
      content: [{ type: "text", text: "Hello world" }],
      details: {
        version: 1,
        id: "msg-001",
        kind: "chat_message",
        timestamp: 1747476060000,
        source: { platform: "onebot", channelId: "group-123", conversationType: "group" },
        actor: { id: "user-alice", name: "Alice" },
        payload: { messageId: "msg-001", content: "Hello world" },
      },
    });
    const result = parseJsonlLine(line);
    expect(result).toEqual({
      id: "msg-001",
      timestamp: new Date(1747476060000).toISOString(),
      role: "user",
      speaker: "Alice",
      content: "Hello world",
      channelKey: "",
    });
  });

  it("returns null for non-chat_message events", () => {
    const line = JSON.stringify({
      type: "custom_message",
      id: "evt-001",
      customType: "athena:event",
      content: [],
      details: {
        version: 1,
        id: "evt-001",
        kind: "member_change",
        timestamp: 1747476060000,
        source: { platform: "onebot", channelId: "group-123" },
        actor: { id: "user-alice", name: "Alice" },
        payload: {},
      },
    });
    expect(parseJsonlLine(line)).toBeNull();
  });

  it("falls back to actor.id when name is missing", () => {
    const line = JSON.stringify({
      type: "custom_message",
      id: "msg-010",
      customType: "athena:event",
      content: [{ type: "text", text: "Hi" }],
      details: {
        version: 1,
        id: "msg-010",
        kind: "chat_message",
        timestamp: 1747476060000,
        source: { platform: "onebot", channelId: "group-123" },
        actor: { id: "user-alice" },
        payload: { messageId: "msg-010", content: "Hi" },
      },
    });
    const result = parseJsonlLine(line);
    expect(result?.speaker).toBe("user-alice");
  });

  it("returns null for unsupported event versions", () => {
    const line = JSON.stringify({
      type: "custom_message",
      id: "msg-011",
      customType: "athena:event",
      content: [{ type: "text", text: "Hi" }],
      details: {
        version: 2,
        id: "msg-011",
        kind: "chat_message",
        timestamp: 1747476060000,
        source: { platform: "onebot", channelId: "group-123" },
        actor: { id: "user-alice", name: "Alice" },
        payload: { messageId: "msg-011", content: "Hi" },
      },
    });
    expect(parseJsonlLine(line)).toBeNull();
  });

  it("parses assistant message correctly", () => {
    const line = JSON.stringify({
      type: "message",
      id: "msg-002",
      parentId: "msg-001",
      timestamp: "2026-05-17T10:02:00Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "I can help with that." }],
      },
    });
    const result = parseJsonlLine(line);
    expect(result).toEqual({
      id: "msg-002",
      timestamp: "2026-05-17T10:02:00Z",
      role: "assistant",
      speaker: "assistant",
      content: "I can help with that.",
      channelKey: "",
    });
  });

  it("returns null for tool-call messages", () => {
    const line = JSON.stringify({
      type: "message",
      id: "msg-004",
      parentId: "msg-003",
      timestamp: "2026-05-17T10:04:00Z",
      message: {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "tc-1", toolName: "run_tests", args: {} }],
      },
    });
    expect(parseJsonlLine(line)).toBeNull();
  });

  it("returns null for tool-result messages", () => {
    const line = JSON.stringify({
      type: "message",
      id: "msg-005",
      parentId: "msg-004",
      timestamp: "2026-05-17T10:04:30Z",
      message: {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "tc-1", result: "ok" }],
      },
    });
    expect(parseJsonlLine(line)).toBeNull();
  });

  it("returns null for session_info", () => {
    const line = JSON.stringify({
      type: "session_info",
      id: "info-001",
      parentId: null,
      timestamp: "2026-05-17T14:02:00Z",
      name: "test",
    });
    expect(parseJsonlLine(line)).toBeNull();
  });

  it("returns null for session header", () => {
    const line = JSON.stringify({
      type: "session",
      id: "sess-001",
      timestamp: "2026-05-17T10:00:00Z",
      cwd: "/workspace",
    });
    expect(parseJsonlLine(line)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseJsonlLine("{invalid json")).toBeNull();
  });

  it("returns null for empty lines", () => {
    expect(parseJsonlLine("")).toBeNull();
    expect(parseJsonlLine("   ")).toBeNull();
  });

});

describe("scanJsonlFile", () => {
  const fixturePath = join(FIXTURE_DIR, "sample-session.jsonl");

  it("scans file and returns only chat messages", async () => {
    const results = await scanJsonlFile(fixturePath, {});
    // Should skip: session header, tool-call (msg-004), tool-result (msg-005), session_info
    // Should include: msg-001, msg-002, msg-003, msg-006, msg-007, msg-008, msg-009, msg-010
    expect(results.length).toBe(8);
    expect(results.every((r) => r.id.startsWith("msg-"))).toBe(true);
  });

  it("respects maxLines limit", async () => {
    const results = await scanJsonlFile(fixturePath, { maxLines: 4 });
    // First 4 lines: session header (skip), msg-001, msg-002, msg-003
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("respects maxHits limit", async () => {
    const results = await scanJsonlFile(fixturePath, { maxHits: 3 });
    expect(results.length).toBe(3);
  });

  it("filters by content matcher", async () => {
    const results = await scanJsonlFile(fixturePath, {
      contentMatcher: (c) => c.includes("Docker"),
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.content.includes("Docker"))).toBe(true);
  });

  it("filters by sender matcher", async () => {
    const results = await scanJsonlFile(fixturePath, {
      senderMatcher: (s) => s === "Alice",
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.speaker === "Alice")).toBe(true);
  });

  it("filters by role", async () => {
    const results = await scanJsonlFile(fixturePath, {
      roleMatcher: (r) => r === "assistant",
    });
    expect(results.every((r) => r.role === "assistant")).toBe(true);
  });

  it("filters by time range", async () => {
    const since = new Date("2026-05-17T14:00:00Z").getTime();
    const results = await scanJsonlFile(fixturePath, { since });
    expect(results.every((r) => new Date(r.timestamp).getTime() >= since)).toBe(true);
  });
});
