import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SessionManager } from "../../src/services/session/session-manager";

describe("session legacy incompatibility", () => {
  it("rejects legacy timeline JSONL as incompatible in restore path", () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "athena-legacy-rejection-"));
    const legacyFile = join(sessionDir, "legacy.jsonl");

    const header = {
      type: "session",
      version: 1,
      id: "legacy-session",
      channelKey: "discord:legacy",
      timestamp: new Date().toISOString(),
      modelId: "openai:gpt-4.1",
    };

    const legacyTimeline = {
      type: "timeline",
      id: "legacy-entry-1",
      parentId: null,
      timestamp: new Date().toISOString(),
      record: {
        id: "legacy-record-1",
        kind: "channel_message",
        timestamp: Date.now(),
        stage: "ingress",
        visibility: "model",
        materialization: "default",
        message: {
          kind: "channel_message",
          platform: "discord",
          channelId: "legacy",
          messageId: "legacy-msg-1",
          timestamp: Date.now(),
          content: "legacy timeline row",
          sender: { userId: "u1", username: "legacy" },
          isDirect: false,
          atSelf: false,
          isReplyToBot: false,
        },
      },
    };

    writeFileSync(
      legacyFile,
      `${JSON.stringify(header)}\n${JSON.stringify(legacyTimeline)}\n`,
      "utf8",
    );

    expect(() => SessionManager.open(legacyFile, "discord:legacy")).toThrow(
      /legacy|incompatible|timeline/i,
    );
  });
});
