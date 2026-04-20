import { describe, expect, it } from "vitest";

import type { AthenaMessage } from "../../src/services/session/domain/athena-message";
import type {
  ActivationResultEntry,
  AssistantMessage,
  CompactionEntry,
  ResponseStatusEntry,
  SessionEntry,
  SessionHeader,
  SessionInfoEntry,
  SessionMessage,
  SessionMessageEntry,
  ToolResultMessage,
} from "../../src/services/session/domain/session-message";

describe("session entry contracts", () => {
  it("locks SessionEntry helper entry discriminants and message entry boundary", () => {
    const header: SessionHeader = {
      type: "session",
      version: 1,
      id: "session-1",
      channelKey: "discord:channel-1",
      timestamp: new Date(1_710_000_000_000).toISOString(),
      modelId: "openai:gpt-4.1",
    };

    const message: SessionMessageEntry = {
      type: "message",
      id: "entry-message-1",
      parentId: null,
      timestamp: new Date(1_710_000_000_001).toISOString(),
      message: {
        type: "user.message",
        timestamp: new Date(1_710_000_000_001).toISOString(),
        data: {
          messageId: "msg-1",
          senderId: "user-1",
          senderName: "alice",
          content: "hello",
        },
      },
    };

    const activation: ActivationResultEntry = {
      type: "activation_result",
      id: "entry-activation-1",
      parentId: "entry-message-1",
      timestamp: new Date(1_710_000_000_002).toISOString(),
      batchId: "batch-1",
      activated: true,
      reasons: ["at_self"],
    };

    const responseStatus: ResponseStatusEntry = {
      type: "response_status",
      id: "entry-response-1",
      parentId: "entry-activation-1",
      timestamp: new Date(1_710_000_000_003).toISOString(),
      endReason: "normal",
      nextAction: "idle",
      stepsCompleted: 1,
      durationMs: 50,
    };

    const compaction: CompactionEntry = {
      type: "compaction",
      id: "entry-compaction-1",
      parentId: "entry-response-1",
      timestamp: new Date(1_710_000_000_004).toISOString(),
      summary: "summary",
      firstKeptEntryId: "entry-message-1",
      tokensBefore: 200,
    };

    const sessionInfo: SessionInfoEntry = {
      type: "session_info",
      id: "entry-session-info-1",
      parentId: "entry-compaction-1",
      timestamp: new Date(1_710_000_000_005).toISOString(),
      infoType: "model_change",
      provider: "openai",
      modelId: "gpt-4.1",
    };

    const entries: SessionEntry[] = [header, message, activation, responseStatus, compaction, sessionInfo];

    expect(entries.map((entry) => entry.type)).toEqual([
      "session",
      "message",
      "activation_result",
      "response_status",
      "compaction",
      "session_info",
    ]);

    expect(entries.some((entry) => entry.type === "timeline")).toBe(false);
  });

  it("locks SessionMessage as AthenaMessage | AssistantMessage | ToolResultMessage", () => {
    const athenaVariants: AthenaMessage[] = [
      {
        type: "user.message",
        timestamp: new Date(1_710_000_000_010).toISOString(),
        data: {
          messageId: "msg-10",
          senderId: "user-10",
          content: "hello user message",
        },
      },
      {
        type: "notice.member.join",
        timestamp: new Date(1_710_000_000_011).toISOString(),
        data: { content: "member joined" },
      },
      {
        type: "notice.member.leave",
        timestamp: new Date(1_710_000_000_012).toISOString(),
        data: { content: "member left" },
      },
      {
        type: "notice.reaction",
        timestamp: new Date(1_710_000_000_013).toISOString(),
        data: { content: "member reacted" },
      },
      {
        type: "notice.state.update",
        timestamp: new Date(1_710_000_000_014).toISOString(),
        data: { content: "state updated" },
      },
    ];

    const assistantMessage: AssistantMessage = {
      role: "assistant",
      content: "assistant reply",
    };

    const toolResultMessage: ToolResultMessage = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "tool-call-1",
          toolName: "search",
          output: {
            type: "text",
            value: "ok",
          },
        },
      ],
    };

    const sessionMessages: SessionMessage[] = [
      ...athenaVariants,
      assistantMessage,
      toolResultMessage,
    ];

    expect(sessionMessages.map((message) => message.type ?? message.role)).toEqual([
      "user.message",
      "notice.member.join",
      "notice.member.leave",
      "notice.reaction",
      "notice.state.update",
      "assistant",
      "tool",
    ]);
  });
});
