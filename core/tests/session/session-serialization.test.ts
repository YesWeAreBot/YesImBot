import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SessionManager } from "../../src/services/session/session-manager";

describe("session serialization", () => {
  it("writes deterministic key order for persisted message/session entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "athena-session-serialization-"));
    const manager = SessionManager.create("test:channel", dir, "gpt-4.1");

    manager.appendAthenaMessage({
      type: "user.message",
      timestamp: new Date(1).toISOString(),
      data: {
        messageId: "msg-1",
        senderId: "user-1",
        senderName: "alice",
        content: "hi",
      },
    });
    manager.appendAssistantMessage({
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
    });

    const file = manager.getSessionFile();
    const lines = readFileSync(file!, "utf8").trim().split("\n");
    expect(lines[0]).toMatch(/^\{"type":"session","version":1,/);
    expect(lines[1]).toMatch(/^\{"type":"message","id":"[^"]+","parentId":null,/);
    expect(lines[1]).toContain('"message":{"type":"user.message"');
    expect(lines[2]).toMatch(/^\{"type":"message","id":"[^"]+","parentId":"[^"]+",/);
    expect(lines[2]).toContain('"message":{"role":"assistant"');
    expect(lines.join("\n")).not.toContain('"type":"timeline"');
  });
});
