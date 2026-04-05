import { describe, expect, it } from "vitest";

import { TIMELINE_RECORD_KINDS } from "../../../src/services/session/contracts";
import type {
  AssistantMessageRecord,
  CanonicalChannelEventInput,
  CanonicalChannelMessageInput,
  SystemNoticeRecord,
  TimelineRecord,
  ToolMessageRecord,
} from "../../../src/services/session/contracts";

describe("timeline contracts", () => {
  it("host/runtime handles stay outside canonical channel inputs", () => {
    const message: CanonicalChannelMessageInput<{ sourceMessageId: string }> = {
      kind: "channel_message",
      platform: "discord",
      channelId: "channel-1",
      messageId: "msg-1",
      timestamp: 1,
      content: "hello",
      sender: {
        userId: "user-1",
        username: "alice",
        nickname: "Alice",
        identity: "member",
      },
      isDirect: false,
      atSelf: true,
      isReplyToBot: false,
      raw: {
        sourceMessageId: "raw-1",
      },
    };

    expect("bot" in message).toBe(false);
    expect("session" in message).toBe(false);
    expect("elements" in message).toBe(false);
  });

  it("freezes the six timeline discriminants", () => {
    const kinds: TimelineRecord["kind"][] = [...TIMELINE_RECORD_KINDS];

    expect(new Set(kinds)).toEqual(
      new Set([
        "channel_message",
        "channel_event",
        "assistant_message",
        "tool_message",
        "state_change",
        "system_notice",
      ]),
    );
  });

  it("stores normalized message metadata instead of pre-rendered model text", () => {
    const message: CanonicalChannelMessageInput<{ sourceMessageId: string }> = {
      kind: "channel_message",
      platform: "discord",
      channelId: "channel-1",
      messageId: "msg-1",
      timestamp: 1,
      content: "plain inbound text",
      sender: {
        userId: "user-1",
        username: "alice",
        nickname: "Alice",
        identity: "member",
      },
      isDirect: true,
      atSelf: false,
      isReplyToBot: true,
      replyTo: {
        messageId: "msg-0",
        userId: "bot-1",
        username: "athena",
        nickname: "Athena",
        summary: "previous message",
      },
      raw: {
        sourceMessageId: "raw-1",
      },
    };

    expect(message.content).toBe("plain inbound text");
    expect(message.replyTo?.summary).toBe("previous message");
    expect(message.sender.identity).toBe("member");
  });

  it("preserves assistant/tool role alignment as durable truth", () => {
    const assistantRecord: AssistantMessageRecord = {
      id: "assistant-1",
      kind: "assistant_message",
      timestamp: 1,
      stage: "runtime",
      visibility: "model",
      materialization: "default",
      message: {
        role: "assistant",
        content: "done",
      },
    };
    const toolRecord: ToolMessageRecord = {
      id: "tool-1",
      kind: "tool_message",
      timestamp: 2,
      stage: "runtime",
      visibility: "model",
      materialization: "default",
      message: {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "lookupWeather",
            output: { value: 21 },
          },
        ],
      },
    };

    expect(assistantRecord.message.role).toBe("assistant");
    expect(toolRecord.message.role).toBe("tool");
  });

  it("keeps channel_event open for typed non-message expansion", () => {
    const event: CanonicalChannelEventInput<{ targetMessageId: string }> = {
      kind: "channel_event",
      platform: "discord",
      channelId: "channel-1",
      eventId: "evt-1",
      eventType: "reaction_added",
      timestamp: 1,
      sourceUserId: "user-1",
      raw: {
        targetMessageId: "msg-1",
      },
    };

    expect(event.eventType).toBe("reaction_added");
    expect(event.raw?.targetMessageId).toBe("msg-1");
  });

  it("marks SystemNotice subtype records hidden by default", () => {
    const notice: SystemNoticeRecord = {
      id: "notice-1",
      kind: "system_notice",
      timestamp: 3,
      stage: "runtime",
      visibility: "hidden",
      materialization: "hidden",
      subType: "compaction_ready",
      materializationKey: "hidden",
      notice: "compaction complete",
    };

    expect(notice.subType).toBe("compaction_ready");
    expect(notice.visibility).toBe("hidden");
    expect(notice.materialization).toBe("hidden");
  });
});
