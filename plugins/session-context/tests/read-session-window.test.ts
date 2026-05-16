import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createReadSessionWindowTool } from "../src/tools";
import type { SessionContextConfig } from "../src/types";
import { writeChannelFixture, writeJsonl } from "./helpers";

function makeConfig(tempDir: string, isolation = false): SessionContextConfig {
  return { sessionsDir: tempDir, isolation, defaultLimit: 20, maxLimit: 100 };
}

describe("read-session-window", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "session-context-window-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reads context around anchor timestamp", async () => {
    const channelKey = await writeChannelFixture(tempDir, "onebot", "10001", {
      platform: "onebot",
      channel: "10001",
      current_session: "current.jsonl",
    });
    await writeJsonl(tempDir, `${channelKey}/current.jsonl`, [
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2026-05-15T12:00:00.000Z",
        content: "before",
        details: { senderId: "alice" },
      },
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2026-05-15T12:00:01.000Z",
        content: "anchor line",
        details: { senderId: "alice" },
      },
      {
        type: "message",
        timestamp: "2026-05-15T12:00:02.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "after" }] },
      },
    ]);

    const tool = createReadSessionWindowTool(makeConfig(tempDir), null);
    const result = await tool.execute({
      platform: "onebot",
      channelId: "10001",
      sessionId: "current",
      anchorTimestamp: "2026-05-15T12:00:01.000Z",
      before: 1,
      after: 1,
    });

    expect(result).toMatchObject({ anchorFound: true });
    expect(
      (result as { window: Array<{ content: string }> }).window.map((entry) => entry.content),
    ).toEqual(["before", "anchor line", "after"]);
  });

  it("falls back to anchorQuery inside session", async () => {
    const channelKey = await writeChannelFixture(tempDir, "discord", "guild-1", {
      platform: "discord",
      channel: "guild-1",
      current_session: "chat.jsonl",
    });
    await writeJsonl(tempDir, `${channelKey}/chat.jsonl`, [
      {
        type: "custom_message",
        customType: "athena:message",
        timestamp: "2026-05-15T12:00:00.000Z",
        content: "vector memory note",
        details: { senderId: "alice" },
      },
    ]);

    const tool = createReadSessionWindowTool(makeConfig(tempDir), null);
    const result = await tool.execute({
      channelKey,
      sessionId: "chat",
      anchorQuery: "vector memory",
      before: 0,
      after: 0,
    });

    expect(result).toMatchObject({ anchorFound: true });
  });

  it("rejects missing locator in shared mode", async () => {
    const tool = createReadSessionWindowTool(makeConfig(tempDir), null);
    const result = await tool.execute({ sessionId: "current" });
    expect(result).toMatchObject({ code: "CHANNEL_REQUIRED" });
  });
});
