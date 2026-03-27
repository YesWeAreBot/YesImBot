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

      manager.appendCustomMessageEntry("channel_message", "[alice]: hello", false);

      const sessionFile = manager.getSessionFile();
      expect(sessionFile).toBeDefined();
      expect(existsSync(sessionFile!)).toBe(true);

      const content = readFileSync(sessionFile!, "utf8");
      expect(content).toContain('"type":"session"');
      expect(content).toContain('"type":"custom_message"');
    });

    it.todo("returns same session for same channel key");
  });

  describe("continueRecent", () => {
    it("recovers most recent valid session file", () => {
      const tempBase = mkdtempSync(join(tmpdir(), "athena-session-manager-"));
      const sessionDir = join(tempBase, "discord_12345", "session");

      const manager = SessionManager.create("discord:12345", sessionDir, "openai:gpt-4.1");
      manager.appendCustomMessageEntry("channel_message", "[alice]: hello", false);
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
});
