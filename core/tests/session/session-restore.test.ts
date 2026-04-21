import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SessionManager } from "../../src/services/session/session-manager";

describe("session restore", () => {
  it("rejects legacy timeline fixture and only accepts current session-entry JSONL", () => {
    const fixture = readFileSync("tests/session/fixtures/sample-session.jsonl", "utf8");
    expect(fixture).toContain('"type":"timeline"');
    expect(() =>
      SessionManager.open("tests/session/fixtures/sample-session.jsonl", "discord:test"),
    ).toThrow(/timeline\/custom\/model_change rows are not supported/);
  });

  it("restores current message/session-entry JSONL from disk", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "athena-restore-current-"));
    const manager = SessionManager.create("discord:restore", tempDir, "openai:gpt-4.1");
    manager.appendAssistantMessage({
      role: "assistant",
      content: [
        { type: "text", text: "Calling tool..." },
        {
          type: "tool-call",
          toolCallId: "tc-001",
          toolName: "test_tool",
          input: { q: "hello" },
        },
      ],
    });
    manager.appendResponseStatus({
      endReason: "exception",
      nextAction: "idle",
      stepsCompleted: 1,
      durationMs: 12,
      error: "tool crashed",
      blockedReason: "tool crashed",
    });

    const restored = SessionManager.open(manager.getSessionFile()!, "discord:restore");
    expect(restored.getEntries()).toEqual([
      expect.objectContaining({ type: "message" }),
      expect.objectContaining({
        type: "response_status",
        endReason: "exception",
        nextAction: "idle",
        error: "tool crashed",
        blockedReason: "tool crashed",
      }),
      expect.objectContaining({
        type: "message",
        message: {
          role: "tool",
          content: expect.arrayContaining([
            expect.objectContaining({
              type: "tool-result",
              toolCallId: "tc-001",
              toolName: "test_tool",
              output: {
                type: "json",
                value: "Session interrupted before tool execution completed",
              },
            }),
          ]),
        },
      }),
    ]);
    expect(restored.getModelMessages()).toEqual([
      expect.objectContaining({ role: "assistant" }),
      expect.objectContaining({ role: "tool" }),
    ]);
  });
});
