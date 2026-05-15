import { describe, it, expect } from "vitest";

import { parseJsonlLine, extractTextContent } from "../src/jsonl-parser";

describe("parseJsonlLine", () => {
  it("parses user message (athena:message)", () => {
    const line = JSON.stringify({
      type: "custom_message",
      customType: "athena:message",
      content: "你好",
      details: {
        kind: "chat_message",
        senderId: "1293865264",
        timestamp: 1778848392302,
      },
      timestamp: "2026-05-15T12:33:12.310Z",
    });
    const result = parseJsonlLine(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("user");
    expect(result!.content).toBe("你好");
    expect(result!.sender).toBe("1293865264");
  });

  it("parses assistant text message", () => {
    const line = JSON.stringify({
      type: "message",
      timestamp: "2026-05-15T12:33:16.500Z",
      message: {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking..." },
          { type: "text", text: "诶，你好呀！" },
        ],
      },
    });
    const result = parseJsonlLine(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("assistant");
    expect(result!.content).toBe("诶，你好呀！");
  });

  it("returns null for tool-call", () => {
    const line = JSON.stringify({
      type: "message",
      timestamp: "2026-05-15T12:33:13.790Z",
      message: {
        role: "assistant",
        content: [{ type: "tool-call", toolName: "grep", input: {} }],
      },
    });
    const result = parseJsonlLine(line);
    expect(result).toBeNull();
  });

  it("returns null for tool-result", () => {
    const line = JSON.stringify({
      type: "message",
      timestamp: "2026-05-15T12:33:13.839Z",
      message: {
        role: "tool",
        content: [{ type: "tool-result", toolName: "grep", output: {} }],
      },
    });
    const result = parseJsonlLine(line);
    expect(result).toBeNull();
  });

  it("parses session header", () => {
    const line = JSON.stringify({
      type: "session",
      id: "abc-123",
      timestamp: "2026-05-15T12:33:12.287Z",
    });
    const result = parseJsonlLine(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("session");
    expect(result!.sessionId).toBe("abc-123");
  });

  it("returns null for session_info", () => {
    const line = JSON.stringify({
      type: "session_info",
      id: "2300f8d5",
      name: "onebot:679014594",
    });
    const result = parseJsonlLine(line);
    expect(result).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const result = parseJsonlLine("not json");
    expect(result).toBeNull();
  });

  it("returns null for empty line", () => {
    const result = parseJsonlLine("");
    expect(result).toBeNull();
  });

  it("handles assistant message with only reasoning (no text)", () => {
    const line = JSON.stringify({
      type: "message",
      timestamp: "2026-05-15T12:33:13.790Z",
      message: {
        role: "assistant",
        content: [
          { type: "reasoning", text: "just thinking" },
          { type: "tool-call", toolName: "grep", input: {} },
        ],
      },
    });
    const result = parseJsonlLine(line);
    // Has tool-call in content → null (filtered)
    expect(result).toBeNull();
  });

  it("truncates content to 500 chars with ellipsis", () => {
    const longText = "a".repeat(600);
    const line = JSON.stringify({
      type: "custom_message",
      customType: "athena:message",
      content: longText,
      details: { senderId: "user1" },
      timestamp: "2026-05-15T12:33:12.310Z",
    });
    const result = parseJsonlLine(line);
    expect(result).not.toBeNull();
    expect(result!.content.length).toBeLessThanOrEqual(503); // 500 + "..."
    expect(result!.content).toContain("...");
  });
});

describe("extractTextContent", () => {
  it("extracts text parts from content array", () => {
    const content = [
      { type: "reasoning", text: "thinking..." },
      { type: "text", text: "hello" },
      { type: "text", text: " world" },
    ];
    expect(extractTextContent(content)).toBe("hello world");
  });

  it("returns empty string when no text parts", () => {
    const content = [
      { type: "reasoning", text: "thinking..." },
      { type: "tool-call", toolName: "grep", input: {} },
    ];
    expect(extractTextContent(content)).toBe("");
  });

  it("handles string content", () => {
    expect(extractTextContent("direct text")).toBe("direct text");
  });
});
