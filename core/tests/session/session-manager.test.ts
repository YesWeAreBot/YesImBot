import { existsSync, mkdtempSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SessionManager } from "../../src/services/session/session-manager";

function createUserMessage(content: string, messageId: string) {
  return {
    type: "user.message" as const,
    timestamp: new Date(1_710_000_000_000).toISOString(),
    data: {
      messageId,
      senderId: "user-1",
      senderName: "alice",
      content,
    },
  };
}

describe("SessionManager", () => {
  describe("lazy init per channel", () => {
    it("creates session directory on first access and persists message-first JSONL", () => {
      const tempBase = mkdtempSync(join(tmpdir(), "athena-session-manager-"));
      const sessionDir = join(tempBase, "discord_12345", "session");

      const manager = SessionManager.create("discord:12345", sessionDir, "openai:gpt-4.1");

      expect(existsSync(sessionDir)).toBe(true);

      manager.appendAthenaMessage(createUserMessage("hello", "msg-1"));

      const sessionFile = manager.getSessionFile();
      expect(sessionFile).toBeDefined();
      expect(existsSync(sessionFile!)).toBe(true);

      const content = readFileSync(sessionFile!, "utf8");
      expect(content).toContain('"type":"session"');
      expect(content).toContain('"type":"message"');
      expect(content).toContain('"type":"user.message"');
      expect(content).not.toContain('"type":"timeline"');
    });

    it.todo("returns same session for same channel key");
  });

  describe("continueRecent", () => {
    it("recovers most recent valid session file", () => {
      const tempBase = mkdtempSync(join(tmpdir(), "athena-session-manager-"));
      const sessionDir = join(tempBase, "discord_12345", "session");

      const manager = SessionManager.create("discord:12345", sessionDir, "openai:gpt-4.1");
      manager.appendAthenaMessage(createUserMessage("hello", "msg-1"));
      manager.appendAssistantMessage({
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
      });

      const restored = SessionManager.continueRecent("discord:12345", sessionDir);
      expect(restored).not.toBeNull();
      expect(restored!.getEntryCount()).toBe(manager.getEntryCount());
    });

    it("restores the latest valid session for the requested channel only", () => {
      const tempBase = mkdtempSync(join(tmpdir(), "athena-session-manager-"));
      const sessionDir = join(tempBase, "discord_12345", "session");

      const targetSession = SessionManager.create("discord:12345", sessionDir, "openai:gpt-4.1");
      targetSession.appendAthenaMessage(createUserMessage("target session", "msg-target-1"));

      const unrelatedSession = SessionManager.create("discord:99999", sessionDir, "openai:gpt-4.1");
      unrelatedSession.appendAthenaMessage({
        type: "user.message",
        timestamp: new Date(1_710_000_000_001).toISOString(),
        data: {
          messageId: "msg-other-1",
          senderId: "user-2",
          senderName: "bob",
          content: "other session",
        },
      });

      const restored = SessionManager.restoreOrCreateRecent("discord:12345", sessionDir);

      expect(restored).toMatchObject({ status: "restored" });
      expect(restored.sessionManager.getHeader().channelKey).toBe("discord:12345");
      expect(restored.sessionManager.getSessionMessages()).toEqual([
        expect.objectContaining({
          type: "user.message",
          data: expect.objectContaining({ content: "target session" }),
        }),
      ]);
    });

    it("restoreOrCreateRecent recovers the newest usable session before falling back to created", () => {
      const tempBase = mkdtempSync(join(tmpdir(), "athena-session-manager-"));
      const sessionDir = join(tempBase, "discord_12345", "session");

      const older = SessionManager.create("discord:12345", sessionDir, "openai:gpt-4.1");
      older.appendAssistantMessage({
        role: "assistant",
        content: [{ type: "text", text: "older reply" }],
      });

      const newer = SessionManager.create("discord:12345", sessionDir, "openai:gpt-4.1");
      newer.appendAssistantMessage({
        role: "assistant",
        content: [{ type: "text", text: "newer reply" }],
      });

      utimesSync(older.getSessionFile()!, new Date(1_000), new Date(1_000));
      utimesSync(newer.getSessionFile()!, new Date(2_000), new Date(2_000));

      const restored = SessionManager.restoreOrCreateRecent("discord:12345", sessionDir);

      expect(restored).toMatchObject({ status: "restored" });
      expect(restored.sessionManager.getModelMessages()).toEqual([
        {
          role: "assistant",
          content: [{ type: "text", text: "newer reply" }],
        },
      ]);
    });

    it("creates a new session only when no recoverable session exists", () => {
      const tempBase = mkdtempSync(join(tmpdir(), "athena-session-manager-"));
      const sessionDir = join(tempBase, "discord_12345", "session");

      const restored = SessionManager.restoreOrCreateRecent(
        "discord:12345",
        sessionDir,
        "openai:gpt-4.1",
      );

      expect(restored.status).toBe("created");
      expect(restored.sessionManager.getEntryCount()).toBe(0);
      expect(restored.sessionManager.getSessionFile()).toBeDefined();
    });
  });

  describe("channel directory contract", () => {
    it("session files live under basePath/platform_channelId/", () => {
      const tempBase = mkdtempSync(join(tmpdir(), "athena-session-manager-"));
      const sessionDir = join(tempBase, "discord_12345", "session");
      const manager = SessionManager.create("discord:12345", sessionDir, "openai:gpt-4.1");

      const sessionFile = manager.getSessionFile();
      expect(sessionFile).toBeDefined();
      expect(sessionFile!).toContain(sessionDir);
      expect(sessionFile!).toMatch(/\.jsonl$/);
    });

    it("creates session/ subdirectory per D-07", () => {
      const tempBase = mkdtempSync(join(tmpdir(), "athena-session-manager-"));
      const sessionDir = join(tempBase, "discord_999", "session");

      SessionManager.create("discord:999", sessionDir, "openai:gpt-4.1");
      expect(existsSync(sessionDir)).toBe(true);
    });
  });

  describe("workspace config", () => {
    it.todo("uses global config when workspace config absent per D-08");
  });

  describe("message-first persistence", () => {
    it("persists channel messages as canonical session entries", () => {
      const manager = SessionManager.inMemory("discord:12345");
      manager.appendAthenaMessage(createUserMessage("hello", "msg-1"));

      const entries = manager.getEntries();

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: "message",
        message: expect.objectContaining({
          type: "user.message",
          data: expect.objectContaining({ content: "hello" }),
        }),
      });
    });
  });
});
