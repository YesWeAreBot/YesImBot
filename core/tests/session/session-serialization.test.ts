import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SessionManager } from "../../src/services/session/session-manager";

describe("session serialization", () => {
  it("writes deterministic key order for persisted session entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "athena-session-"));
    const manager = SessionManager.create("test:channel", dir, "gpt-4.1");

    manager.appendTimelineRecord({
      id: "message-1",
      kind: "channel_message",
      timestamp: 1,
      stage: "ingress",
      visibility: "model",
      materialization: "default",
      message: {
        kind: "channel_message",
        platform: "test",
        channelId: "channel",
        messageId: "msg-1",
        timestamp: 1,
        content: "hi",
        sender: {
          userId: "user-1",
          username: "alice",
        },
        isDirect: true,
        atSelf: false,
        isReplyToBot: false,
      },
    });
    manager.appendTimelineRecord({
      id: "assistant-1",
      kind: "assistant_message",
      timestamp: 2,
      stage: "runtime",
      visibility: "model",
      materialization: "default",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
      },
    });

    const file = manager.getSessionFile();
    const lines = readFileSync(file!, "utf8").trim().split("\n");
    expect(lines[1]).toMatch(/^\{"type":"timeline","record":\{"id":"message-1","kind":"channel_message"/);
    expect(lines[2]).toMatch(/^\{"type":"timeline","record":\{"id":"assistant-1","kind":"assistant_message"/);
  });
});
