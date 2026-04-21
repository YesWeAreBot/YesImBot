import { describe, expect, it } from "vitest";

import { AgentSession } from "../../src/services/session/agent-session";
import { buildGenerateInputForTest } from "../../src/services/session/runtime";
import { SessionManager } from "../../src/services/session/session-manager";

function createSession(): AgentSession {
  return new AgentSession(SessionManager.inMemory("discord:channel-1"));
}

describe("SessionRuntime and StepTranscriptWriter context", () => {
  it("passes canonical user messages into generate input", () => {
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

    expect(generateInput.messages[0]).toMatchObject({ role: "system" });
    expect(generateInput.messages[1]).toMatchObject({ role: "user", content: "hi" });
  });

  it("does not project StepTranscriptWriter protocol guidance into rebuilt model context", () => {
    const session = createSession();
    session.appendRuntimeStateInfo("protocol_guidance", undefined, {
      content: "Visible IM replies must be sent with send_message",
    });

    const generateInput = buildGenerateInputForTest({
      instructions: "You are helpful.",
      session,
    });

    expect(generateInput.messages).toHaveLength(1);
    expect(generateInput.messages[0]).toMatchObject({ role: "system" });
  });
});
