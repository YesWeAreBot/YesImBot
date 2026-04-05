import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SessionManager } from "../../src/services/session/session-manager";

describe("session restore", () => {
  it("restores canonical projections from persisted session data", () => {
    const fixture = readFileSync("tests/session/fixtures/sample-session.jsonl", "utf8");
    const restored = SessionManager.open("tests/session/fixtures/sample-session.jsonl", "discord:test");

    expect(fixture).toContain('"type":"timeline"');
    expect(fixture).not.toContain('"type":"custom_message"');
    expect(restored.getTimeline()).toEqual([
      expect.objectContaining({ kind: "channel_message" }),
      expect.objectContaining({ kind: "assistant_message" }),
      expect.objectContaining({ kind: "tool_message" }),
    ]);
    expect(restored.getModelMessages()).toEqual([
      expect.objectContaining({ role: "user" }),
      expect.objectContaining({ role: "assistant" }),
      expect.objectContaining({ role: "tool" }),
    ]);
  });

  describe("repairs orphan tool calls", () => {
    it("appends synthetic error tool result for unresolved tool-call on restore", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "athena-restore-"));
      const manager = SessionManager.create("discord:restore", tempDir, "openai:gpt-4.1");

      manager.appendMessage({
        role: "assistant",
        content: [
          { type: "text", text: "Calling tool..." },
          {
            type: "tool-call",
            toolCallId: "tc-001",
            toolName: "test_tool",
            args: { q: "hello" },
          },
        ],
        timestamp: Date.now(),
        provider: "openai",
        model: "gpt-4.1",
      });

      const sessionFile = manager.getSessionFile();
      expect(sessionFile).toBeDefined();

      const restored = SessionManager.open(sessionFile!, "discord:restore");
      const entries = restored.getEntries();
      const lastEntry = entries[entries.length - 1];

      expect(lastEntry.type).toBe("timeline");
      if (lastEntry.type !== "timeline") {
        throw new Error("expected timeline entry");
      }

      expect(lastEntry.record.kind).toBe("tool_message");
      if (lastEntry.record.kind !== "tool_message") {
        throw new Error("expected tool message record");
      }

      expect(lastEntry.record.message.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "tool-result",
            toolCallId: "tc-001",
            toolName: "test_tool",
            isError: true,
            output: {
              type: "json",
              value: expect.stringContaining("Session interrupted"),
            },
          }),
        ]),
      );
    });
  });
});
