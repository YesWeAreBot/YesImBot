import { describe, expect, it } from "vitest";

import {
  materializeTimeline,
  materializeTimelineRecord,
} from "../../../src/services/session/materialize";
import type { TimelineRecord } from "../../../src/services/session/types/index";

describe("timeline materialization", () => {
  it("materializes channel_message from normalized metadata instead of durable text", () => {
    const result = materializeTimelineRecord({
      id: "msg-1",
      kind: "channel_message",
      timestamp: 1,
      stage: "ingress",
      visibility: "model",
      materialization: "default",
      message: {
        kind: "channel_message",
        platform: "discord",
        channelId: "channel-1",
        messageId: "message-1",
        timestamp: 1,
        content: "hello from channel",
        sender: {
          userId: "user-1",
          username: "alice",
          nickname: "Alice",
          identity: "member",
        },
        isDirect: true,
        atSelf: true,
        isReplyToBot: false,
      },
    });

    expect(result).toEqual([
      {
        role: "user",
        content: expect.stringContaining("hello from channel"),
      },
    ]);
    expect(String(result[0]?.content)).toContain("direct=true");
  });

  it("keeps assistant and tool records aligned with AI SDK roles", () => {
    const assistantResult = materializeTimelineRecord({
      id: "assistant-1",
      kind: "assistant_message",
      timestamp: 2,
      stage: "runtime",
      visibility: "model",
      materialization: "default",
      message: {
        role: "assistant",
        content: "done",
      },
    });
    const toolResult = materializeTimelineRecord({
      id: "tool-1",
      kind: "tool_message",
      timestamp: 3,
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
    });

    expect(assistantResult).toEqual([{ role: "assistant", content: "done" }]);
    expect(toolResult).toEqual([
      {
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
    ]);
  });

  it("applies dedicated rules for channel_event and state_change records", () => {
    const records: TimelineRecord[] = [
      {
        id: "evt-1",
        kind: "channel_event",
        timestamp: 4,
        stage: "runtime",
        visibility: "internal",
        materialization: "internal",
        event: {
          kind: "channel_event",
          platform: "discord",
          channelId: "channel-1",
          eventId: "evt-1",
          eventType: "reaction_added",
          timestamp: 4,
          sourceUserId: "user-1",
        },
      },
      {
        id: "state-1",
        kind: "state_change",
        timestamp: 5,
        stage: "runtime",
        visibility: "internal",
        materialization: "internal",
        stateType: "response_state",
        data: {
          status: "idle",
        },
      },
    ];

    const result = materializeTimeline(records, { includeInternal: true });

    expect(result).toHaveLength(2);
    expect(String(result[0]?.content)).toContain("reaction_added");
    expect(String(result[1]?.content)).toContain("response_state");
  });

  it("respects visibility and materialization hints", () => {
    const result = materializeTimeline([
      {
        id: "msg-hidden",
        kind: "channel_message",
        timestamp: 6,
        stage: "runtime",
        visibility: "hidden",
        materialization: "hidden",
        message: {
          kind: "channel_message",
          platform: "discord",
          channelId: "channel-1",
          messageId: "msg-hidden",
          timestamp: 6,
          content: "hidden text",
          sender: {
            userId: "user-1",
            username: "alice",
          },
          isDirect: false,
          atSelf: false,
          isReplyToBot: false,
        },
      },
    ]);

    expect(result).toEqual([]);
  });

  it("keeps system_notice hidden until a subType strategy opts in", () => {
    const notice: TimelineRecord = {
      id: "notice-1",
      kind: "system_notice",
      timestamp: 7,
      stage: "runtime",
      visibility: "hidden",
      materialization: "subtype",
      subType: "compaction_summary",
      materializationKey: "compaction-summary",
      notice: "compaction complete",
      data: {
        coveredEntries: 12,
      },
    };

    expect(materializeTimelineRecord(notice)).toEqual([]);
    expect(
      materializeTimelineRecord(notice, {
        systemNoticeStrategies: {
          compaction_summary: (record) => ({
            role: "system",
            content: `${record.notice} (${record.subType})`,
          }),
        },
      }),
    ).toEqual([
      {
        role: "system",
        content: "compaction complete (compaction_summary)",
      },
    ]);
  });
});
