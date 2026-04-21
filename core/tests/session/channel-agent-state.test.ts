import { describe, expect, it } from "vitest";

import { AgentSession } from "../../src/services/session/agent-session";
import { SessionManager } from "../../src/services/session/session-manager";

describe("session state helpers", () => {
  it("keeps response_status and runtime_state helper entries out of model context", () => {
    const session = new AgentSession(SessionManager.inMemory("discord:channel-1"));

    session.appendAthenaMessage({
      type: "user.message",
      timestamp: new Date(1_710_000_000_000).toISOString(),
      data: {
        messageId: "msg-1",
        senderId: "user-1",
        senderName: "alice",
        content: "hello",
      },
    });
    session.appendResponseStatus({
      endReason: "exception",
      nextAction: "blocked",
      stepsCompleted: 1,
      durationMs: 12,
    });
    session.appendRuntimeStateInfo("protocol_guidance", undefined, {
      content: "Visible IM replies must be sent with send_message",
    });

    expect(session.getEntries().map((entry) => entry.type)).toEqual([
      "message",
      "response_status",
      "session_info",
    ]);
    expect(session.getModelMessages()).toEqual([{ role: "user", content: "hello" }]);
  });

  it("preserves assistant messages while helper entries remain sidecars", () => {
    const session = new AgentSession(SessionManager.inMemory("discord:channel-1"));

    session.appendAssistantMessage({
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    });
    session.appendResponseStatus({
      endReason: "normal",
      nextAction: "idle",
      stepsCompleted: 1,
      durationMs: 20,
    });

    expect(session.getModelMessages()).toEqual([expect.objectContaining({ role: "assistant" })]);
    expect(session.getEntries().some((entry) => entry.type === "response_status")).toBe(true);
  });

  it("stores follow_up_review metadata as runtime_state session_info", () => {
    const session = new AgentSession(SessionManager.inMemory("discord:channel-1"));

    session.appendRuntimeStateInfo(
      "follow_up_review",
      {
        id: "follow-up-1",
        timestamp: 1_710_000_000_010,
      },
      {
        messageCount: 2,
        messageIds: ["msg-2", "msg-3"],
        content: "[Follow-up Review]\nObserved window: 2",
      },
    );

    expect(session.getEntries()).toEqual([
      expect.objectContaining({
        type: "session_info",
        infoType: "runtime_state",
        stateType: "follow_up_review",
        data: expect.objectContaining({
          messageCount: 2,
          messageIds: ["msg-2", "msg-3"],
        }),
      }),
    ]);
  });
});
