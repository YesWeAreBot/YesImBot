import { describe, expect, it } from "vitest";

import { AgentSession } from "../../src/services/session/agent-session";
import { buildGenerateInputForTest } from "../../src/services/session/runtime";
import { SessionManager } from "../../src/services/session/session-manager";

function createSession(): AgentSession {
  return new AgentSession(SessionManager.inMemory("discord:channel-1"));
}

describe("channel runtime canonical input", () => {
  it("builds generate input from message-only durable context", () => {
    const session = createSession();
    session.appendAthenaMessage({
      type: "user.message",
      timestamp: new Date(1_710_000_000_000).toISOString(),
      data: {
        messageId: "msg-1",
        senderId: "user-1",
        senderName: "alice",
        content: "hi",
      },
    });

    const generateInput = buildGenerateInputForTest({
      instructions: "You are helpful.",
      session,
    });

    expect(generateInput.messages).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "hi" },
    ]);
  });

  it("keeps helper entries out of rebuilt model context", () => {
    const session = createSession();
    session.appendAthenaMessage({
      type: "user.message",
      timestamp: new Date(1_710_000_000_001).toISOString(),
      data: {
        messageId: "msg-2",
        senderId: "user-1",
        senderName: "alice",
        content: "wake runtime",
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

    const generateInput = buildGenerateInputForTest({
      instructions: "You are helpful.",
      session,
    });

    expect(generateInput.messages).toHaveLength(2);
    expect(generateInput.messages[0]).toMatchObject({ role: "system" });
    expect(generateInput.messages[1]).toMatchObject({ role: "user", content: "wake runtime" });
  });
});
