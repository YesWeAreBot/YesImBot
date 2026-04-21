import { describe, expect, it } from "vitest";

import { AgentSession } from "../../src/services/session/agent-session";
import type { ChannelKey } from "../../src/services/session/messages";
import { SessionManager } from "../../src/services/session/session-manager";

const channelKey: ChannelKey = "discord:channel-1";

function createSessionManager(): SessionManager {
  return SessionManager.inMemory(channelKey);
}

function createUserMessage(content: string, messageId = "msg-1") {
  return {
    type: "user.message" as const,
    timestamp: new Date(100).toISOString(),
    data: {
      messageId,
      senderId: "user-1",
      senderName: "alice",
      content,
    },
  };
}

describe("AgentSession", () => {
  it("exposes entries, session messages, and model messages while helper entries stay out of model context", () => {
    const session = new AgentSession(createSessionManager());

    session.appendAthenaMessage(createUserMessage("hello"));
    session.appendRuntimeStateInfo(
      "response_state",
      {
        id: "state-1",
        timestamp: 101,
      },
      { status: "idle" },
    );

    expect(session.getEntries()).toHaveLength(2);
    expect(session.getSessionMessages()).toEqual([
      expect.objectContaining({ type: "user.message" }),
    ]);
    expect(session.getModelMessages()).toEqual([
      expect.objectContaining({ role: "user", content: "hello" }),
    ]);
    expect(
      session
        .getEntries()
        .find((entry) => entry.type === "session_info" && entry.infoType === "runtime_state"),
    ).toMatchObject({
      type: "session_info",
      infoType: "runtime_state",
      stateType: "response_state",
    });
  });

  it("writes assistant and tool durable truth as first-class session messages", () => {
    const session = new AgentSession(createSessionManager());

    session.appendAssistantMessage({
      role: "assistant",
      content: "done",
    });
    session.appendToolResultMessage({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "lookupWeather",
          output: {
            type: "json",
            value: { value: 21 },
          },
        },
      ],
    });

    expect(session.getSessionMessages()).toEqual([
      expect.objectContaining({ role: "assistant" }),
      expect.objectContaining({ role: "tool" }),
    ]);
    expect(session.getModelMessages()).toEqual([
      expect.objectContaining({ role: "assistant" }),
      expect.objectContaining({ role: "tool" }),
    ]);
  });

  it("refreshes cache when response_status and runtime_state helpers are appended", () => {
    const session = new AgentSession(createSessionManager());

    session.appendResponseStatus({
      endReason: "normal",
      nextAction: "idle",
      stepsCompleted: 1,
      durationMs: 12,
    });
    session.appendRuntimeStateInfo(
      "follow_up_review",
      {
        id: "follow-up-state-1",
        timestamp: 107,
      },
      {
        messageCount: 1,
        messageIds: ["msg-1"],
      },
    );

    expect(session.getEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "response_status", endReason: "normal" }),
        expect.objectContaining({
          type: "session_info",
          infoType: "runtime_state",
          stateType: "follow_up_review",
          id: "follow-up-state-1",
        }),
      ]),
    );
  });

  it("prepends latest compaction summary while keeping messages from firstKeptEntryId onward", () => {
    const sessionManager = createSessionManager();
    const session = new AgentSession(sessionManager);

    const firstId = session.appendAthenaMessage(createUserMessage("older message", "msg-old-1"));
    session.appendAthenaMessage(createUserMessage("newer message", "msg-new-1"));
    session.appendCompaction("summary", firstId, 128);

    expect(session.getModelMessages()).toEqual([
      {
        role: "user",
        content: "[Context Summary]\nsummary",
      },
      expect.objectContaining({ role: "user", content: "older message" }),
      expect.objectContaining({ role: "user", content: "newer message" }),
    ]);
  });
});
