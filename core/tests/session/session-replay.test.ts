import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AgentSession } from "../../src/services/session/agent-session";
import { convertToLlm } from "../../src/services/session/materialize";
import { SessionManager } from "../../src/services/session/session-manager";

describe("session replay", () => {
  it("replay restores session entries and message-only projection from persisted JSONL", () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "athena-session-replay-"));
    const manager = SessionManager.create("discord:replay", sessionDir, "openai:gpt-4.1");

    manager.appendMessage({
      role: "user",
      content: "hello replay",
      timestamp: Date.now(),
    });

    manager.appendCustomEntry("activation_result", {
      batchId: "batch-1",
      activated: true,
      reasons: ["at_self"],
    });

    manager.appendCustomEntry("response_status", {
      endReason: "normal",
      nextAction: "idle",
      stepsCompleted: 1,
      durationMs: 12,
    });

    const firstEntryId = manager.getEntries()[0]?.id;
    expect(firstEntryId).toBeDefined();
    manager.appendCompaction("summary", firstEntryId!, 128);
    manager.appendModelChange("openai", "gpt-4.1");

    const sessionFile = manager.getSessionFile();
    expect(sessionFile).toBeDefined();

    const persisted = readFileSync(sessionFile!, "utf8");
    expect(persisted).toContain('"type":"message"');
    expect(persisted).toContain('"type":"activation_result"');
    expect(persisted).toContain('"type":"response_status"');
    expect(persisted).toContain('"type":"compaction"');
    expect(persisted).toContain('"type":"session_info"');

    const providerMessagesBeforeRestore = convertToLlm(manager.getSessionMessages());

    const restored = SessionManager.restoreOrCreateRecent("discord:replay", sessionDir);

    expect(restored.status).toBe("restored");
    const restoredEntries = restored.sessionManager.getEntries();
    expect(restoredEntries.map((entry) => entry.type)).toEqual(
      expect.arrayContaining([
        "message",
        "activation_result",
        "response_status",
        "compaction",
        "session_info",
      ]),
    );

    expect(restored.sessionManager.getModelMessages()).toEqual([
      expect.objectContaining({ role: "user" }),
    ]);

    const providerMessagesAfterRestore = convertToLlm(restored.sessionManager.getSessionMessages());
    expect(providerMessagesAfterRestore).toEqual(providerMessagesBeforeRestore);
  });

  it("replay keeps compaction summary prepend and firstKeptEntryId boundary on message-entry history", () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "athena-session-replay-compaction-"));
    const manager = SessionManager.create(
      "discord:replay-compaction",
      sessionDir,
      "openai:gpt-4.1",
    );

    const firstId = manager.appendAthenaMessage({
      type: "user.message",
      timestamp: new Date(1_710_000_000_000).toISOString(),
      data: {
        messageId: "msg-old-1",
        senderId: "user-1",
        senderName: "alice",
        content: "older message",
      },
    });
    manager.appendAthenaMessage({
      type: "user.message",
      timestamp: new Date(1_710_000_000_001).toISOString(),
      data: {
        messageId: "msg-new-1",
        senderId: "user-2",
        senderName: "bob",
        content: "newer message",
      },
    });
    manager.appendCompaction("summary from replay", firstId, 64);

    const restored = SessionManager.restoreOrCreateRecent("discord:replay-compaction", sessionDir);
    expect(restored.status).toBe("restored");

    const restoredSession = new AgentSession(restored.sessionManager);
    const modelMessages = restoredSession.getModelMessages();

    expect(modelMessages[0]).toEqual({
      role: "user",
      content: "[Context Summary]\nsummary from replay",
    });
    expect(modelMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("older message"),
        }),
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("newer message"),
        }),
      ]),
    );
    expect(
      restored.sessionManager.getEntries().some((entry) => {
        return (
          entry.type === "compaction" &&
          entry.firstKeptEntryId === firstId &&
          entry.summary === "summary from replay"
        );
      }),
    ).toBe(true);
  });

  it("replay preserves follow_up_review state semantics through session_info bridge", () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "athena-session-replay-follow-up-"));
    const manager = SessionManager.create("discord:replay-follow-up", sessionDir, "openai:gpt-4.1");
    const session = new AgentSession(manager);

    session.appendStateChange({
      id: "follow-up-review-1",
      timestamp: 1_710_000_000_010,
      stage: "runtime",
      visibility: "internal",
      materialization: "internal",
      stateType: "follow_up_review",
      data: {
        messageCount: 2,
        messageIds: ["msg-2", "msg-3"],
        content: "Observed window: 2\nTracked message IDs: msg-2, msg-3",
      },
    });

    const restored = SessionManager.restoreOrCreateRecent("discord:replay-follow-up", sessionDir);
    const followUpState = restored.sessionManager
      .getTimeline()
      .find((entry) => entry.kind === "state_change" && entry.stateType === "follow_up_review");

    expect(followUpState).toBeTruthy();
    expect(followUpState).toMatchObject({
      kind: "state_change",
      stateType: "follow_up_review",
      data: {
        messageCount: 2,
        messageIds: ["msg-2", "msg-3"],
        content: expect.stringContaining("Observed window:"),
      },
    });
  });
});
