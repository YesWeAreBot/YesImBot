import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SessionManager } from "../../src/services/session/session-manager";

describe("session serialization", () => {
  it("writes deterministic key order for persisted session entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "athena-session-"));
    const manager = SessionManager.create("test:channel", dir, "gpt-4.1");

    manager.appendCustomMessageEntry("channel_message", "[alice]: hi", false);
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1,
      provider: "openai",
      model: "gpt-4.1",
    });

    const file = manager.getSessionFile();
    const lines = readFileSync(file!, "utf8").trim().split("\n");
    expect(lines[1]).toMatch(
      /^\{"type":"custom_message","customType":"channel_message","content":"\[alice\]: hi","display":false,/,
    );
    expect(lines[2]).toMatch(/^\{"type":"message","id":"/);
  });
});
