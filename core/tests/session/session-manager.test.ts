import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SessionManager } from "../../src/services/session/session-manager";

describe("SessionManager", () => {
  describe("lazy init per channel", () => {
    it("creates session directory on first access", () => {
      const tempBase = mkdtempSync(join(tmpdir(), "athena-session-manager-"));
      const sessionDir = join(tempBase, "discord_12345", "session");

      const manager = SessionManager.create("discord:12345", sessionDir, "openai:gpt-4.1");

      expect(existsSync(sessionDir)).toBe(true);

      manager.appendTimelineRecord({
        id: "message-1",
        kind: "channel_message",
        timestamp: 1,
        stage: "ingress",
        visibility: "model",
        materialization: "default",
        message: {
          kind: "channel_message",
          platform: "discord",
          channelId: "12345",
          messageId: "msg-1",
          timestamp: 1,
          content: "hello",
          sender: {
            userId: "user-1",
            username: "alice",
          },
          isDirect: true,
          atSelf: false,
          isReplyToBot: false,
        },
      });

      const sessionFile = manager.getSessionFile();
      expect(sessionFile).toBeDefined();
      expect(existsSync(sessionFile!)).toBe(true);

      const content = readFileSync(sessionFile!, "utf8");
      expect(content).toContain('"type":"session"');
      expect(content).toContain('"type":"timeline"');
      expect(content).toContain('"kind":"channel_message"');
    });

    it.todo("returns same session for same channel key");
  });

  describe("continueRecent", () => {
    it("recovers most recent valid session file", () => {
      const tempBase = mkdtempSync(join(tmpdir(), "athena-session-manager-"));
      const sessionDir = join(tempBase, "discord_12345", "session");

      const manager = SessionManager.create("discord:12345", sessionDir, "openai:gpt-4.1");
      manager.appendTimelineRecord({
        id: "message-1",
        kind: "channel_message",
        timestamp: 1,
        stage: "ingress",
        visibility: "model",
        materialization: "default",
        message: {
          kind: "channel_message",
          platform: "discord",
          channelId: "12345",
          messageId: "msg-1",
          timestamp: 1,
          content: "hello",
          sender: {
            userId: "user-1",
            username: "alice",
          },
          isDirect: true,
          atSelf: false,
          isReplyToBot: false,
        },
      });
      manager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        timestamp: Date.now(),
        provider: "openai",
        model: "gpt-4.1",
      });

      const restored = SessionManager.continueRecent("discord:12345", sessionDir);
      expect(restored).not.toBeNull();
      expect(restored!.getEntryCount()).toBe(manager.getEntryCount());
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

  describe("channel message records", () => {
    it("persists channel messages as canonical timeline entries", () => {
      const manager = SessionManager.inMemory("discord:12345");
      manager.appendTimelineRecord({
        id: "message-1",
        kind: "channel_message",
        timestamp: 1,
        stage: "ingress",
        visibility: "model",
        materialization: "default",
        message: {
          kind: "channel_message",
          platform: "discord",
          channelId: "12345",
          messageId: "msg-1",
          timestamp: 1,
          content: "hello",
          sender: {
            userId: "user-1",
            username: "alice",
            nickname: "alice",
            identity: "direct-user",
          },
          isDirect: true,
          atSelf: false,
          isReplyToBot: false,
        },
      });

      const entries = manager.getEntries();

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ type: "timeline" });
    });
  });
});
