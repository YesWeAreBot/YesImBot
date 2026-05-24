import { writeFileSync, mkdirSync, rmSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadEntriesFromFile,
  SessionManager,
  type SessionHeader,
} from "../../src/session/session-manager.js";

// ============================================================================
// Helpers
// ============================================================================

let tempDir: string;

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "session-header-test-"));
}

function writeSessionFile(dir: string, filename: string, lines: object[]): string {
  const filePath = join(dir, filename);
  const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

// ============================================================================
// Tests
// ============================================================================

describe("SessionHeader", () => {
  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("new header does not contain cwd", () => {
    it("inMemory() header has no cwd field", () => {
      const sm = SessionManager.inMemory("/tmp/test");
      const header = sm.getHeader();

      expect(header).toBeDefined();
      expect(header!.type).toBe("session");
      expect(header!.id).toBeDefined();
      expect(header!.timestamp).toBeDefined();
      expect(header).not.toHaveProperty("cwd");
    });

    it("new session headers omit cwd and consumers should not need getCwd", () => {
      const sm = SessionManager.inMemory();
      const header = sm.getHeader();
      expect(header).toMatchObject({ type: "session" });
      expect(header).not.toHaveProperty("cwd");
    });

    it("create() header has no cwd field", () => {
      const sessionDir = join(tempDir, "sessions");
      mkdirSync(sessionDir, { recursive: true });
      const sm = SessionManager.create(sessionDir, "/tmp/test");
      const header = sm.getHeader();

      expect(header).toBeDefined();
      expect(header!.type).toBe("session");
      expect(header!.id).toBeDefined();
      expect(header!.timestamp).toBeDefined();
      expect(header).not.toHaveProperty("cwd");
    });

    it("newSession() header has no cwd field", () => {
      const sm = SessionManager.inMemory("/tmp/test");
      sm.newSession();
      const header = sm.getHeader();

      expect(header).toBeDefined();
      expect(header).not.toHaveProperty("cwd");
    });

    it("newSession() with parentSession option has no cwd field", () => {
      const sm = SessionManager.inMemory("/tmp/test");
      sm.newSession({ parentSession: "/some/parent.jsonl" });
      const header = sm.getHeader();

      expect(header).toBeDefined();
      expect(header!.parentSession).toBe("/some/parent.jsonl");
      expect(header).not.toHaveProperty("cwd");
    });

    it("forkFrom() header has no cwd field", () => {
      const sourceHeader: SessionHeader & { cwd: string } = {
        type: "session",
        id: "source-session",
        timestamp: "2026-05-24T00:00:00.000Z",
        cwd: "/old/project",
      };
      const sourcePath = writeSessionFile(tempDir, "source.jsonl", [sourceHeader]);
      const targetDir = join(tempDir, "forked");

      const forked = SessionManager.forkFrom(sourcePath, targetDir, "/new/project");
      const forkedPath = forked.getSessionFile();

      expect(forkedPath).toBeDefined();

      const entries = loadEntriesFromFile(forkedPath!);
      const header = entries[0] as SessionHeader;

      expect(header).toMatchObject({
        type: "session",
        parentSession: sourcePath,
      });
      expect(header).not.toHaveProperty("cwd");
    });
  });

  describe("old header with cwd can be read", () => {
    it("loadEntriesFromFile reads old header with cwd", () => {
      const oldHeader: SessionHeader & { cwd: string } = {
        type: "session",
        id: "old-session-id",
        timestamp: "2025-01-01T00:00:00.000Z",
        cwd: "/home/user/project",
      };
      const filePath = writeSessionFile(tempDir, "old-session.jsonl", [oldHeader]);

      const entries = loadEntriesFromFile(filePath);

      expect(entries).toHaveLength(1);
      const header = entries[0] as SessionHeader;
      expect(header.type).toBe("session");
      expect(header.id).toBe("old-session-id");
      expect((header as SessionHeader & { cwd: string }).cwd).toBe("/home/user/project");
    });

    it("loadEntriesFromFile reads old header with cwd and entries", () => {
      const oldHeader = {
        type: "session",
        id: "old-session-with-entries",
        timestamp: "2025-01-01T00:00:00.000Z",
        cwd: "/home/user/project",
      };
      const messageEntry = {
        type: "message",
        id: "msg-001",
        parentId: null,
        timestamp: "2025-01-01T00:01:00.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "hello" }],
          timestamp: 1735689660000,
        },
      };
      const filePath = writeSessionFile(tempDir, "old-session-entries.jsonl", [
        oldHeader,
        messageEntry,
      ]);

      const entries = loadEntriesFromFile(filePath);

      expect(entries).toHaveLength(2);
      expect((entries[0] as SessionHeader & { cwd: string }).cwd).toBe("/home/user/project");
      expect(entries[1].type).toBe("message");
    });

    it("loadEntriesFromFile reads new header without cwd", () => {
      const newHeader: SessionHeader = {
        type: "session",
        id: "new-session-id",
        timestamp: "2026-05-24T00:00:00.000Z",
      };
      const filePath = writeSessionFile(tempDir, "new-session.jsonl", [newHeader]);

      const entries = loadEntriesFromFile(filePath);

      expect(entries).toHaveLength(1);
      const header = entries[0] as SessionHeader;
      expect(header.type).toBe("session");
      expect(header.id).toBe("new-session-id");
      expect(header).not.toHaveProperty("cwd");
    });
  });

  describe("SessionManager.open() reads old files with cwd compatibility", () => {
    it("open() uses header cwd when no cwdOverride", () => {
      const oldHeader = {
        type: "session",
        id: "compat-session-1",
        timestamp: "2025-06-01T00:00:00.000Z",
        cwd: "/old/project/path",
      };
      const filePath = writeSessionFile(tempDir, "compat-1.jsonl", [oldHeader]);

      const sm = SessionManager.open(filePath);

      expect(sm.getSessionId()).toBe("compat-session-1");
      expect(sm.getCwd()).toBe("/old/project/path");
    });

    it("open() uses cwdOverride when provided", () => {
      const oldHeader = {
        type: "session",
        id: "compat-session-2",
        timestamp: "2025-06-01T00:00:00.000Z",
        cwd: "/old/project/path",
      };
      const filePath = writeSessionFile(tempDir, "compat-2.jsonl", [oldHeader]);

      const sm = SessionManager.open(filePath, undefined, "/new/override/path");

      expect(sm.getSessionId()).toBe("compat-session-2");
      expect(sm.getCwd()).toBe("/new/override/path");
    });

    it("open() falls back to process.cwd() when header has no cwd and no cwdOverride", () => {
      const newHeader: SessionHeader = {
        type: "session",
        id: "no-cwd-session",
        timestamp: "2026-05-24T00:00:00.000Z",
      };
      const filePath = writeSessionFile(tempDir, "no-cwd.jsonl", [newHeader]);

      const sm = SessionManager.open(filePath);

      expect(sm.getSessionId()).toBe("no-cwd-session");
      expect(sm.getCwd()).toBe(process.cwd());
    });

    it("open() reads entries from old session file", () => {
      const oldHeader = {
        type: "session",
        id: "compat-session-3",
        timestamp: "2025-06-01T00:00:00.000Z",
        cwd: "/old/project",
      };
      const msg1 = {
        type: "message",
        id: "msg-100",
        parentId: null,
        timestamp: "2025-06-01T00:01:00.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "old message" }],
          timestamp: 1748736060000,
        },
      };
      const msg2 = {
        type: "message",
        id: "msg-101",
        parentId: "msg-100",
        timestamp: "2025-06-01T00:02:00.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "old response" }],
          usage: { promptTokens: 10, completionTokens: 5 },
          finishReason: "stop",
          timestamp: 1748736120000,
        },
      };
      const filePath = writeSessionFile(tempDir, "compat-3.jsonl", [oldHeader, msg1, msg2]);

      const sm = SessionManager.open(filePath);

      expect(sm.getEntries()).toHaveLength(2);
      expect(sm.getSessionId()).toBe("compat-session-3");
    });

    it("open() does not rewrite old header on append", () => {
      const oldHeader = {
        type: "session",
        id: "compat-no-rewrite",
        timestamp: "2025-06-01T00:00:00.000Z",
        cwd: "/old/project",
      };
      const filePath = writeSessionFile(tempDir, "no-rewrite.jsonl", [oldHeader]);

      const sm = SessionManager.open(filePath);
      // Append a message — this should NOT rewrite the header
      sm.appendMessage({
        role: "user",
        content: [{ type: "text", text: "new message" }],
        timestamp: Date.now(),
      });

      // Re-read the file and verify header still has cwd
      const entries = loadEntriesFromFile(filePath);
      const header = entries[0] as SessionHeader & { cwd: string };
      expect(header.cwd).toBe("/old/project");
    });
  });

  describe("SessionHeader interface", () => {
    it("allows optional parentSession", () => {
      const sm = SessionManager.inMemory("/tmp/test");
      sm.newSession({ parentSession: "/some/parent.jsonl" });
      const header = sm.getHeader();

      expect(header!.parentSession).toBe("/some/parent.jsonl");
    });

    it("parentSession is undefined when not provided", () => {
      const sm = SessionManager.inMemory("/tmp/test");
      sm.newSession();
      const header = sm.getHeader();

      expect(header!.parentSession).toBeUndefined();
    });

    it("header type is always 'session'", () => {
      const sm = SessionManager.inMemory("/tmp/test");
      const header = sm.getHeader();

      expect(header!.type).toBe("session");
    });
  });
});
