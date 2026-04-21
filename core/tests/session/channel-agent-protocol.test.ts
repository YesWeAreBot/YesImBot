import { existsSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { AgentSession } from "../../src/services/session/agent-session";
import {
  buildGenerateInputForTest,
  createSendMessageTool,
  type SendMessageResult,
} from "../../src/services/session/runtime";
import { SessionManager } from "../../src/services/session/session-manager";

function createSendResult(overrides: Partial<SendMessageResult> = {}): SendMessageResult {
  return {
    toolCallId: "call-1",
    utteranceId: "utt-1",
    requestHeartbeat: false,
    success: true,
    segments: [
      {
        segmentId: "seg-1",
        index: 0,
        content: "hello",
        success: true,
        messageIds: ["m-1"],
      },
    ],
    ...overrides,
  };
}

describe("protocol/runtime helpers", () => {
  it("send_message sends segments in order and returns structured results", async () => {
    const bot = {
      selfId: "bot-self",
      sendMessage: vi.fn().mockResolvedValueOnce(["m-1"]).mockResolvedValueOnce(["m-2"]),
    };
    const tool = createSendMessageTool({ bot: bot as never, channelId: "channel-1" });

    const result = await tool.execute(
      { segments: ["hello", "world"], request_heartbeat: true },
      { toolCallId: "call-two-segment" },
    );

    expect(bot.sendMessage).toHaveBeenNthCalledWith(1, "channel-1", "hello");
    expect(bot.sendMessage).toHaveBeenNthCalledWith(2, "channel-1", "world");
    expect(result).toMatchObject({
      toolCallId: "call-two-segment",
      requestHeartbeat: true,
      success: true,
    });
  });

  it("keeps protocol retry helper entries out of rebuilt model context", () => {
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
    session.appendRuntimeStateInfo("protocol_assistant_draft", undefined, { text: "visible text" });
    session.appendRuntimeStateInfo("protocol_guidance", undefined, {
      content: "Visible IM replies must be sent with the send_message tool",
    });
    session.appendResponseStatus({
      endReason: "protocol_error",
      nextAction: "blocked",
      stepsCompleted: 1,
      durationMs: 12,
    });

    const rebuilt = buildGenerateInputForTest({
      instructions: "next run",
      session,
    });

    expect(
      session
        .getEntries()
        .filter(
          (entry) =>
            entry.type === "session_info" &&
            entry.infoType === "runtime_state" &&
            (entry.stateType === "protocol_assistant_draft" ||
              entry.stateType === "protocol_guidance"),
        ),
    ).toHaveLength(2);
    expect(
      rebuilt.messages.some(
        (msg) =>
          typeof msg.content === "string" &&
          msg.content.includes("Visible IM replies must be sent"),
      ),
    ).toBe(false);
    expect(
      rebuilt.messages.some(
        (msg) => typeof msg.content === "string" && msg.content.includes("visible text"),
      ),
    ).toBe(false);
  });

  it("persists tool results without fabricating extra user messages", () => {
    const session = new AgentSession(SessionManager.inMemory("discord:channel-1"));
    session.appendAthenaMessage({
      type: "user.message",
      timestamp: new Date(1_710_000_000_000).toISOString(),
      data: {
        messageId: "msg-project",
        senderId: "user-1",
        senderName: "alice",
        content: "hello",
      },
    });
    session.appendToolResultMessage({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "send_message",
          output: { type: "json", value: createSendResult({ requestHeartbeat: true }) },
        },
      ],
    });

    expect(session.getSessionMessages()).toHaveLength(2);
    expect(session.getSessionMessages()[0]).toMatchObject({ type: "user.message" });
    expect(session.getSessionMessages()[1]).toMatchObject({ role: "tool" });
  });

  it("removes legacy text output helper module", () => {
    expect(existsSync("/home/workspace/Athena/core/src/services/session/runtime/output.ts")).toBe(
      false,
    );
  });
});
