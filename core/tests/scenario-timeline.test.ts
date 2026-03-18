import { describe, expect, it } from "vitest";

import {
  buildScenarioTimeline,
  getMarkedEvents,
  getMessageCount,
  getParticipants,
  getRecentTurns,
} from "../src/runtime/scenario-timeline";
import {
  createAgentActionRecord,
  createAgentResponseRecord,
  createHeartbeatRecord,
  createMessageRecord,
  createSummaryRecord,
} from "./fixtures/timeline-entries";

describe("scenario timeline", () => {
  it("builds settled turn skeleton from active segment history with send_message semantics", () => {
    const entries = [
      createSummaryRecord({
        index: 1,
        minutesOffset: 1,
        data: {
          content: "old summary",
          coveredUntil: new Date("2026-03-05T10:01:00Z"),
        },
      }),
      createMessageRecord({
        index: 2,
        minutesOffset: 2,
        data: {
          senderId: "user-a",
          senderName: "Alice",
          content: "first",
        },
      }),
      createMessageRecord({
        index: 3,
        minutesOffset: 3,
        data: {
          senderId: "user-b",
          senderName: "Bob",
          content: "second",
        },
      }),
      createAgentResponseRecord({
        index: 1,
        minutesOffset: 4,
        data: { rawText: "draft response" },
      }),
      createAgentActionRecord({
        index: 1,
        minutesOffset: 5,
        data: {
          actions: [{ name: "send_message", params: { content: "visible output" } }],
          toolResults: [
            {
              name: "send_message",
              success: true,
              status: "ok",
              result: { messageId: "sent-001", content: "visible output" },
            },
          ],
        },
      }),
    ];

    const timeline = buildScenarioTimeline(entries);

    expect(timeline.turns).toHaveLength(1);
    const turn = timeline.turns[0];
    expect(turn).toBeDefined();
    expect(turn?.settlement).toBe("success");
    expect(turn?.messages).toHaveLength(2);
    expect(turn?.events.some((event) => event.type === "agent.response")).toBe(true);
    expect(turn?.visibleOutputs[0]).toMatchObject({
      toolName: "send_message",
      success: true,
      messageId: "sent-001",
    });
  });

  it("default active segment queries return message counts, participants, marked events, and recent settled turns", () => {
    const entries = [
      createMessageRecord({
        index: 1,
        minutesOffset: 0,
        data: {
          senderId: "pre-summary-user",
          senderName: "Legacy",
          content: "before summary",
        },
      }),
      createSummaryRecord({
        index: 2,
        minutesOffset: 1,
        data: {
          content: "boundary summary",
          coveredUntil: new Date("2026-03-05T10:01:00Z"),
        },
      }),
      createMessageRecord({
        index: 3,
        minutesOffset: 2,
        data: {
          senderId: "user-a",
          senderName: "Alice",
          content: "active one",
        },
      }),
      createMessageRecord({
        index: 4,
        minutesOffset: 3,
        data: {
          senderId: "user-b",
          senderName: "Bob",
          content: "active two",
        },
      }),
      createAgentActionRecord({
        index: 2,
        minutesOffset: 4,
        data: {
          actions: [{ name: "send_message", params: { content: "done" } }],
          toolResults: [{ name: "send_message", success: true, result: { messageId: "sent-002" } }],
        },
      }),
    ];

    const timeline = buildScenarioTimeline(entries);

    expect(getMessageCount(timeline)).toBe(2);
    expect(getParticipants(timeline).map((participant) => participant.id)).toEqual([
      "user-a",
      "user-b",
    ]);
    expect(getMarkedEvents(timeline).some((event) => event.type === "tool-result")).toBe(true);
    expect(getRecentTurns(timeline, 1)).toHaveLength(1);
    expect(timeline.activeSegment.mode).toBe("after-latest-summary");
  });

  it("keeps summary in background and renders heartbeat as visible with detail while agent.response stays non-visible", () => {
    const entries = [
      createSummaryRecord({
        index: 3,
        minutesOffset: 1,
        data: {
          content: "background summary",
          coveredUntil: new Date("2026-03-05T10:01:00Z"),
        },
      }),
      createMessageRecord({
        index: 5,
        minutesOffset: 2,
        data: {
          senderId: "user-c",
          senderName: "Carol",
          content: "question",
        },
      }),
      createAgentResponseRecord({
        index: 4,
        minutesOffset: 3,
        data: { rawText: "draft only" },
      }),
      createHeartbeatRecord({
        index: 1,
        minutesOffset: 4,
        data: { triggeredBy: "manual", channelSummary: "heartbeat only" },
      }),
      createAgentActionRecord({
        index: 5,
        minutesOffset: 5,
        data: {
          actions: [{ name: "search_web", params: { q: "weather" } }],
          toolResults: [{ name: "search_web", success: false, error: "timeout" }],
        },
      }),
    ];

    const timeline = buildScenarioTimeline(entries);
    const turn = timeline.turns[0];

    expect(timeline.latestSummary?.content).toBe("background summary");
    expect(timeline.semantics.heartbeatRendering).toBe("visible");
    expect(timeline.heartbeatEvents[0]?.detail?.channelSummary).toBe("heartbeat only");
    expect(turn?.events.some((event) => event.type === "agent.response")).toBe(true);
    expect(turn?.visibleOutputs).toHaveLength(0);
    expect(turn?.settlement).toBe("failed");
  });

  it("derives visibleOutputs messageId and content from structured send_message result payloads", () => {
    const entries = [
      createMessageRecord({
        index: 11,
        minutesOffset: 1,
        data: {
          senderId: "user-structured",
          senderName: "Structured",
          content: "hello",
        },
      }),
      createAgentActionRecord({
        index: 11,
        minutesOffset: 2,
        data: {
          actions: [{ name: "send_message", params: { content: "structured visible output" } }],
          toolResults: [
            {
              name: "send_message",
              success: true,
              result: {
                status: "sent",
                messageId: "sent-structured-1",
                content: "structured visible output",
                messages: [
                  {
                    platform: "test-platform",
                    channelId: "test-channel",
                    messageId: "sent-structured-1",
                    content: "structured visible output",
                  },
                ],
              },
            },
          ],
        },
      }),
    ];

    const timeline = buildScenarioTimeline(entries);
    const turn = timeline.turns[0];

    expect(turn?.visibleOutputs[0]).toMatchObject({
      messageId: "sent-structured-1",
      content: "structured visible output",
    });
  });
});
