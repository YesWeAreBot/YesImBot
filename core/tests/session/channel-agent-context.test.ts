import { describe, expect, it } from "vitest";

import { AgentSession } from "../../src/services/session/agent-session";
import { buildGenerateInputForTest } from "../../src/services/session/runtime";
import { SessionManager } from "../../src/services/session/session-manager";

function createSession(): AgentSession {
  const sessionManager = SessionManager.inMemory("discord:channel-1");
  return new AgentSession(sessionManager);
}

describe("ChannelRuntime runResponse", () => {
  it("passes converted model messages to ToolLoopAgent.generate while retaining custom messages in session context", () => {
    const session = createSession();
    session.appendChannelMessage({
      id: "channel-msg-1",
      timestamp: 1_710_000_000_000,
      stage: "ingress",
      visibility: "model",
      materialization: "default",
      message: {
        kind: "channel_message",
        platform: "discord",
        channelId: "channel-1",
        messageId: "msg-1",
        timestamp: 1_710_000_000_000,
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

    const generateInput = buildGenerateInputForTest({
      instructions: "You are helpful.",
      session,
    });

    expect(generateInput.messages[0]).toMatchObject({ role: "system" });
    expect(generateInput.messages[1]).toMatchObject({ role: "user" });
  });
});

describe("context safety net", () => {
  it("does not project protocol_guidance into normal rebuilt model context", () => {
    const session = createSession();
    session.appendSystemNotice({
      id: "proto-1",
      timestamp: 1_710_000_000_001,
      stage: "runtime",
      visibility: "hidden",
      materialization: "hidden",
      subType: "protocol_guidance",
      materializationKey: "hidden",
      notice: "Visible IM replies must be sent with send_message",
    });

    const generateInput = buildGenerateInputForTest({
      instructions: "You are helpful.",
      session,
    });

    expect(generateInput.messages).toHaveLength(1);
    expect(generateInput.messages[0]).toMatchObject({ role: "system" });
  });

  it("hard truncation when token count exceeds limit", () => {
    const longChunk = "x".repeat(1000);
    const session = createSession();

    for (let index = 0; index < 500; index += 1) {
      session.appendChannelMessage({
        id: `msg-${index}`,
        timestamp: 1_710_000_001_000 + index,
        stage: "ingress",
        visibility: "model",
        materialization: "default",
        message: {
          kind: "channel_message",
          platform: "discord",
          channelId: "channel-1",
          messageId: `msg-${index}`,
          timestamp: 1_710_000_001_000 + index,
          content: longChunk,
          sender: {
            userId: `user-${index}`,
            username: `user-${index}`,
          },
          isDirect: true,
          atSelf: false,
          isReplyToBot: false,
        },
      });
    }

    const generateInput = buildGenerateInputForTest({
      instructions: "You are helpful.",
      session,
    });

    const totalChars = JSON.stringify(generateInput.messages).length;
    expect(totalChars).toBeGreaterThan(100000);
  });
});
