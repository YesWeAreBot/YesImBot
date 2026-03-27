import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSessionContext,
  convertAgentMessagesToModelMessages,
  loadEntriesFromFile,
  SessionManager,
} from "../../src/services/session/session-manager";

describe("session restore", () => {
  it("restores custom messages as custom agent messages and preserves assistant metadata", () => {
    const entries = loadEntriesFromFile("tests/session/fixtures/sample-session.jsonl");
    const ctx = buildSessionContext(entries.filter((entry) => entry.type !== "session"));

    expect(ctx.agentMessages.some((msg) => msg.role === "custom")).toBe(true);
    expect(ctx.agentMessages.find((msg) => msg.role === "assistant")).toMatchObject({
      provider: expect.any(String),
      model: expect.any(String),
    });

    const modelMessages = convertAgentMessagesToModelMessages(ctx.agentMessages);
    expect(modelMessages.some((msg) => msg.role === "user")).toBe(true);
    expect(modelMessages.some((msg) => msg.role === "assistant")).toBe(true);
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

      expect(lastEntry.type).toBe("message");
      if (lastEntry.type !== "message") {
        throw new Error("expected message entry");
      }

      expect(lastEntry.message.role).toBe("tool");
      if (lastEntry.message.role !== "tool") {
        throw new Error("expected tool message");
      }

      expect(lastEntry.message.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "tool-result",
            toolCallId: "tc-001",
            toolName: "test_tool",
            isError: true,
            result: expect.stringContaining("Session interrupted"),
          }),
        ]),
      );
    });
  });
});
