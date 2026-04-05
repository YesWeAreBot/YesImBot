import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SessionManager } from "../../src/services/session/session-manager";

describe("SessionManager canonical timeline persistence", () => {
  it("round-trips canonical timeline records instead of legacy custom_message truth", () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "athena-session-timeline-"));
    const manager = SessionManager.create("discord:channel-1", sessionDir);

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
        channelId: "channel-1",
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
    expect(content).toContain('"type":"timeline"');
    expect(content).toContain('"kind":"channel_message"');
    expect(content).not.toContain('"customType":"channel_message"');
  });

  it("reload restores assistant/tool durable records and materialized model context", () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "athena-session-reload-"));
    const manager = SessionManager.create("discord:channel-1", sessionDir);

    manager.appendTimelineRecord({
      id: "assistant-1",
      kind: "assistant_message",
      timestamp: 2,
      stage: "runtime",
      visibility: "model",
      materialization: "default",
      message: {
        role: "assistant",
        content: "done",
      },
    });
    manager.appendTimelineRecord({
      id: "tool-1",
      kind: "tool_message",
      timestamp: 3,
      stage: "runtime",
      visibility: "model",
      materialization: "default",
      message: {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "lookupWeather",
            output: { value: 21 },
          },
        ],
      },
    });

    const restored = SessionManager.continueRecent("discord:channel-1", sessionDir);

    expect(restored).not.toBeNull();
    expect(restored!.getTimeline()).toEqual([
      expect.objectContaining({ kind: "assistant_message" }),
      expect.objectContaining({ kind: "tool_message" }),
    ]);
    expect(restored!.getModelMessages()).toEqual([
      { role: "assistant", content: "done" },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "lookupWeather",
            output: { value: 21 },
          },
        ],
      },
    ]);
  });

  it("keeps SystemNotice metadata durable but hidden from getModelMessages by default", () => {
    const manager = SessionManager.inMemory("discord:channel-1");

    manager.appendTimelineRecord({
      id: "notice-1",
      kind: "system_notice",
      timestamp: 4,
      stage: "runtime",
      visibility: "hidden",
      materialization: "subtype",
      subType: "compaction_summary",
      materializationKey: "compaction-summary",
      notice: "compaction complete",
      data: {
        coveredEntries: 12,
      },
    });

    expect(manager.getTimeline()[0]).toMatchObject({
      kind: "system_notice",
      subType: "compaction_summary",
      materialization: "subtype",
    });
    expect(manager.getModelMessages()).toEqual([]);
  });
});
