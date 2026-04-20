import { describe, expect, it } from "vitest";

import { convertToLlm } from "../../src/services/session/materialize";
import type {
  ActivationResultEntry,
  CompactionEntry,
  ResponseStatusEntry,
  SessionEntry,
  SessionInfoEntry,
  SessionMessage,
  SessionMessageEntry,
  ToolResultMessage,
} from "../../src/services/session/domain/session-message";

describe("convertToLlm(SessionMessage[])", () => {
  it("maps Athena user.message and notice.* variants to provider user messages", () => {
    const messages: SessionMessage[] = [
      {
        type: "user.message",
        timestamp: new Date(1_710_000_000_000).toISOString(),
        data: {
          messageId: "msg-1",
          senderId: "user-1",
          content: "hello user message",
        },
      },
      {
        type: "notice.member.join",
        timestamp: new Date(1_710_000_000_001).toISOString(),
        data: { content: "member joined" },
      },
      {
        type: "notice.member.leave",
        timestamp: new Date(1_710_000_000_002).toISOString(),
        data: { content: "member left" },
      },
      {
        type: "notice.reaction",
        timestamp: new Date(1_710_000_000_003).toISOString(),
        data: { content: "member reaction" },
      },
      {
        type: "notice.state.update",
        timestamp: new Date(1_710_000_000_004).toISOString(),
        data: { content: "state updated" },
      },
    ];

    const providerMessages = convertToLlm(messages);

    expect(providerMessages).toEqual([
      { role: "user", content: "hello user message" },
      { role: "user", content: "member joined" },
      { role: "user", content: "member left" },
      { role: "user", content: "member reaction" },
      { role: "user", content: "state updated" },
    ]);
  });

  it("keeps assistant and tool messages on existing provider path", () => {
    const assistant: SessionMessage = {
      role: "assistant",
      content: "assistant reply",
    };

    const tool: ToolResultMessage = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "tool-call-1",
          toolName: "search",
          output: { type: "text", value: "search result" },
        },
      ],
    };

    const providerMessages = convertToLlm([assistant, tool]);

    expect(providerMessages).toEqual([assistant, tool]);
  });

  it("convertToLlm(SessionMessage[]) excludes helper entries by boundary and SessionEntry[] is invalid input for conversion", () => {
    const sessionMessageEntry: SessionMessageEntry = {
      type: "message",
      id: "entry-message-1",
      parentId: null,
      timestamp: new Date(1_710_000_000_010).toISOString(),
      message: {
        type: "user.message",
        timestamp: new Date(1_710_000_000_010).toISOString(),
        data: {
          messageId: "msg-10",
          senderId: "user-10",
          content: "safe session message",
        },
      },
    };

    const activationEntry: ActivationResultEntry = {
      type: "activation_result",
      id: "entry-activation-1",
      parentId: "entry-message-1",
      timestamp: new Date(1_710_000_000_011).toISOString(),
      batchId: "batch-1",
      activated: false,
      reasons: ["channel_event"],
    };

    const responseStatusEntry: ResponseStatusEntry = {
      type: "response_status",
      id: "entry-response-1",
      parentId: "entry-activation-1",
      timestamp: new Date(1_710_000_000_012).toISOString(),
      endReason: "normal",
      nextAction: "idle",
      stepsCompleted: 1,
      durationMs: 12,
    };

    const compactionEntry: CompactionEntry = {
      type: "compaction",
      id: "entry-compaction-1",
      parentId: "entry-response-1",
      timestamp: new Date(1_710_000_000_013).toISOString(),
      summary: "compacted summary",
      firstKeptEntryId: "entry-message-1",
      tokensBefore: 128,
    };

    const sessionInfoEntry: SessionInfoEntry = {
      type: "session_info",
      id: "entry-session-info-1",
      parentId: "entry-compaction-1",
      timestamp: new Date(1_710_000_000_014).toISOString(),
      infoType: "model_change",
      provider: "openai",
      modelId: "gpt-4.1",
    };

    const mixedSessionEntries: SessionEntry[] = [
      sessionMessageEntry,
      activationEntry,
      responseStatusEntry,
      compactionEntry,
      sessionInfoEntry,
    ];

    // SessionEntry[] is intentionally invalid input for convertToLlm(); only SessionMessage[] can cross the seam.
    const sessionMessagesOnly = mixedSessionEntries
      .filter((entry): entry is SessionMessageEntry => entry.type === "message")
      .map((entry) => entry.message);

    const providerMessages = convertToLlm(sessionMessagesOnly);
    const forbiddenHelperTypes = new Set([
      activationEntry.type,
      responseStatusEntry.type,
      compactionEntry.type,
      sessionInfoEntry.type,
    ]);
    const serializedProviderMessages = JSON.stringify(providerMessages);

    expect(providerMessages).toEqual([{ role: "user", content: "safe session message" }]);
    expect(serializedProviderMessages).not.toContain("activation_result");
    expect(serializedProviderMessages).not.toContain("response_status");
    expect(serializedProviderMessages).not.toContain("compaction");
    expect(serializedProviderMessages).not.toContain("session_info");
    expect(
      providerMessages.some((message) => {
        if (message.role !== "user") {
          return false;
        }

        return forbiddenHelperTypes.has(String(message.content));
      }),
    ).toBe(false);
  });
});
