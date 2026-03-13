import { describe, expect, it } from "vitest";

import type {
  Scenario,
  ScenarioMarkedEvent,
  ScenarioTimeline,
  ScenarioTimelineHeartbeat,
  ScenarioTurn,
} from "../src/services/runtime/contracts";
import {
  DEFAULT_SCENARIO_TIMELINE_SEMANTICS,
  getMarkedEvents,
  getMessageCount,
  getParticipants,
  getRecentTurns,
} from "../src/services/runtime/contracts";

function createTurn(overrides: Partial<ScenarioTurn> & { id: string }): ScenarioTurn {
  const startedAt = new Date("2026-03-12T08:00:00Z");
  const settledAt = new Date("2026-03-12T08:01:00Z");
  return {
    id: overrides.id,
    startedAt: overrides.startedAt ?? startedAt,
    settledAt: overrides.settledAt ?? settledAt,
    settlement: overrides.settlement ?? "success",
    messages: overrides.messages ?? [],
    events: overrides.events ?? [],
    participants: overrides.participants ?? [],
    visibleOutputs: overrides.visibleOutputs ?? [],
  };
}

function createTimeline(overrides: Partial<ScenarioTimeline> = {}): ScenarioTimeline {
  return {
    turns: overrides.turns ?? [],
    latestSummary: overrides.latestSummary,
    activeSegment: overrides.activeSegment ?? {
      mode: "after-latest-summary",
      summaryId: undefined,
      startedAt: undefined,
    },
    markedEvents: overrides.markedEvents ?? [],
    heartbeatEvents: overrides.heartbeatEvents ?? [],
    semantics: overrides.semantics ?? DEFAULT_SCENARIO_TIMELINE_SEMANTICS,
  };
}

describe("scenario timeline", () => {
  it("keeps Scenario.raw.timeline/scenarioTimeline as typed canonical timeline contracts", () => {
    const timeline = createTimeline({
      turns: [createTurn({ id: "turn-1" })],
    });

    const scenario: Scenario = {
      raw: {
        self: { id: "bot", name: "athena" },
        environment: {
          type: "group",
          id: "room-1",
          name: "General",
          platform: "discord",
          channelId: "c1",
        },
        entities: [],
        timeline: [] as Scenario["raw"]["timeline"],
        scenarioTimeline: timeline,
        stimulusSource: {
          type: "message",
          messageId: "m1",
          senderId: "u1",
        },
      },
      derived: {
        focus: {},
        participants: [],
        attention: {},
        recentMetrics: {},
      },
    };

    expect(scenario.raw.scenarioTimeline?.turns).toHaveLength(1);
  });

  it("default query helpers read active segment after latest summary for counts and participants", () => {
    const beforeSummary = createTurn({
      id: "turn-before",
      settledAt: new Date("2026-03-12T07:59:00Z"),
      messages: [
        {
          id: "m-before",
          messageId: "m-before",
          senderId: "u-before",
          senderName: "Before",
          content: "before",
          timestamp: new Date("2026-03-12T07:58:30Z"),
        },
      ],
      participants: [{ id: "u-before", name: "Before", type: "user" }],
    });

    const active = createTurn({
      id: "turn-active",
      settledAt: new Date("2026-03-12T08:05:00Z"),
      messages: [
        {
          id: "m-active-1",
          messageId: "m-active-1",
          senderId: "u1",
          senderName: "Alice",
          content: "hello",
          timestamp: new Date("2026-03-12T08:03:00Z"),
        },
        {
          id: "m-active-2",
          messageId: "m-active-2",
          senderId: "u2",
          senderName: "Bob",
          content: "hi",
          timestamp: new Date("2026-03-12T08:04:00Z"),
        },
      ],
      participants: [
        { id: "u1", name: "Alice", type: "user" },
        { id: "u2", name: "Bob", type: "user" },
      ],
    });

    const markedEvents: ScenarioMarkedEvent[] = [
      {
        id: "marked-summary",
        type: "summary",
        timestamp: new Date("2026-03-12T08:00:00Z"),
        turnId: undefined,
        detail: { summaryId: "summary-1" },
      },
      {
        id: "marked-active",
        type: "tool-result",
        timestamp: new Date("2026-03-12T08:04:30Z"),
        turnId: "turn-active",
        detail: { name: "send_message" },
      },
    ];

    const timeline = createTimeline({
      turns: [beforeSummary, active],
      latestSummary: {
        id: "summary-1",
        timestamp: new Date("2026-03-12T08:00:00Z"),
        coveredUntil: new Date("2026-03-12T08:00:00Z"),
        content: "summary",
      },
      markedEvents,
    });

    expect(getMessageCount(timeline)).toBe(2);
    expect(getParticipants(timeline).map((participant) => participant.id)).toEqual(["u1", "u2"]);
    expect(getMarkedEvents(timeline).map((event) => event.id)).toEqual(["marked-active"]);
    expect(getRecentTurns(timeline, 1).map((turn) => turn.id)).toEqual(["turn-active"]);
  });

  it("locks summary background, heartbeat query semantics, and agent.response visibility", () => {
    const heartbeat: ScenarioTimelineHeartbeat = {
      id: "hb-1",
      timestamp: new Date("2026-03-12T08:05:10Z"),
      triggeredBy: "manual",
      queryOnly: true,
      detail: { channelSummary: "slow channel" },
    };

    const turn = createTurn({
      id: "turn-visibility",
      events: [
        {
          id: "evt-response",
          type: "agent.response",
          timestamp: new Date("2026-03-12T08:05:00Z"),
          queryOnly: true,
          detail: { rawText: "draft only" },
        },
      ],
      visibleOutputs: [],
    });

    const timeline = createTimeline({
      turns: [turn],
      latestSummary: {
        id: "summary-bg",
        timestamp: new Date("2026-03-12T08:00:00Z"),
        coveredUntil: new Date("2026-03-12T08:00:00Z"),
        content: "background summary",
      },
      heartbeatEvents: [heartbeat],
    });

    expect(timeline.semantics.summaryPosition).toBe("background");
    expect(timeline.semantics.heartbeatRendering).toBe("query-only");
    expect(timeline.semantics.agentResponseVisibility).toBe("internal-draft");
    expect(timeline.semantics.visibleOutputSource).toBe("send_message-success");
    expect(timeline.heartbeatEvents[0]?.queryOnly).toBe(true);
    expect(
      timeline.turns[0]?.events.some((event) => event.type === "agent.response" && event.queryOnly),
    ).toBe(true);
  });
});
