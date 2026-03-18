import { describe, expect, it } from "vitest";

import { HORIZON_SCENARIO_BOUNDARY } from "../src/services/horizon/types";
import type {
  HorizonScenarioAdapterSource,
  HorizonScenarioProjection,
} from "../src/services/horizon/types";
import {
  bindCommittedRoundContext,
  buildCapabilitiesFromRuntime,
  buildScenarioFromView,
  commitRoundContext,
  createRoundContext,
} from "../src/services/runtime/adapters";
import {
  DEFAULT_SCENARIO_TIMELINE_SEMANTICS,
  type ScenarioTimeline,
} from "../src/services/runtime/contracts";

describe("scenario adapter", () => {
  it("marks HorizonView as internal Scenario adapter boundary", () => {
    expect(HORIZON_SCENARIO_BOUNDARY).toBe("internal-scenario-adapter");
  });

  it("keeps Scenario.raw as a structured layered projection", () => {
    const source: HorizonScenarioAdapterSource = {
      view: {
        self: { id: "bot", name: "athena" },
        environment: {
          type: "group",
          id: "room-1",
          name: "General",
          platform: "discord",
          channelId: "c1",
        },
        entities: [{ id: "u1", type: "user", name: "alice" }],
        history: [{ id: "h1", type: "message" }] as unknown as never,
      },
      stimulusSource: {
        type: "message",
        messageId: "m1",
        senderId: "u1",
      },
    };

    const projection: HorizonScenarioProjection = {
      raw: {
        self: source.view.self,
        environment: source.view.environment,
        entities: source.view.entities,
        timeline: source.view.history as unknown as Array<Record<string, unknown>>,
        stimulusSource: source.stimulusSource,
      },
      derived: {
        focus: { topic: "adapter baseline" },
        participants: [{ id: "u1", role: "speaker" }],
        attention: { level: "normal" },
        recentMetrics: { messageCount: 1 },
      },
    };

    expect(projection.raw.timeline[0]).toMatchObject({ id: "h1", type: "message" });
    expect(projection.derived.recentMetrics).toMatchObject({ messageCount: 1 });
  });

  it("keeps stimulusSource as source reference, not copied Percept", () => {
    const source: HorizonScenarioAdapterSource = {
      view: {
        self: { id: "bot", name: "athena" },
        environment: {
          type: "group",
          id: "room-1",
          name: "General",
          platform: "discord",
          channelId: "c1",
        },
        entities: [],
        history: [],
      },
      stimulusSource: {
        type: "message",
        messageId: "m1",
        senderId: "u1",
      },
    };

    expect(source.stimulusSource).toEqual({
      type: "message",
      messageId: "m1",
      senderId: "u1",
    });

    const invalidSource: HorizonScenarioAdapterSource = {
      ...source,
      stimulusSource: {
        ...source.stimulusSource,
        // @ts-expect-error stimulusSource should not carry whole percept metadata bag.
        metadata: { fullPerceptCopy: true },
      },
    };
    expect(invalidSource).toBeTruthy();
  });

  it("builds Scenario from HorizonView plus stimulus references only", () => {
    const source: HorizonScenarioAdapterSource = {
      view: {
        self: { id: "bot", name: "athena" },
        environment: {
          type: "group",
          id: "room-1",
          name: "General",
          platform: "discord",
          channelId: "c1",
        },
        entities: [{ id: "u1", type: "user", name: "alice" }],
        history: [{ id: "m1", type: "message", data: { content: "hello" } }] as never,
      },
      stimulusSource: {
        type: "message",
        messageId: "m1",
        senderId: "u1",
      },
    };

    const scenario = buildScenarioFromView(source);
    expect(scenario.raw.scenarioTimeline).toBeDefined();
    expect(scenario.raw.timeline).toBe(scenario.raw.scenarioTimeline);
    expect(scenario.raw.scenarioTimeline?.turns).toHaveLength(1);
    expect(scenario.raw.scenarioTimeline?.turns[0]?.messages).toHaveLength(1);
    expect(scenario.raw.scenarioTimeline?.turns[0]?.messages[0]).toMatchObject({
      messageId: "m1",
      senderId: "u1",
    });
    expect(scenario.derived.recentMetrics).toMatchObject({
      messageCount: 1,
      turnCount: 1,
      participantCount: 1,
    });
    expect(scenario.derived.participants).toEqual([{ id: "u1", name: "alice", type: "user" }]);
    expect(scenario.raw.stimulusSource).toEqual({
      type: "message",
      messageId: "m1",
      senderId: "u1",
    });
    const sourceRecord = scenario.raw.stimulusSource as unknown as Record<string, unknown>;
    expect(sourceRecord.metadata).toBeUndefined();
    expect(sourceRecord.reason).toBeUndefined();
  });

  it("builds structured core and extended capabilities", () => {
    const capabilities = buildCapabilitiesFromRuntime({
      session: {
        isDirect: false,
        quote: undefined,
      },
      bot: { selfId: "bot-1" },
    });

    expect(capabilities.core["message.send"]?.status).toBe("available");
    expect(capabilities.core["message.read_history"]?.status).toBe("available");
    expect(capabilities.core["message.reply"]?.status).toBe("unavailable");

    if (capabilities.core["message.reply"]?.status === "unavailable") {
      expect(capabilities.core["message.reply"].reason).toBe("quote-message-unavailable");
    }
  });

  it("reports session-derived capabilities as unavailable when session missing", () => {
    const capabilities = buildCapabilitiesFromRuntime({
      session: undefined,
      bot: { selfId: "bot-1" },
    });

    expect(capabilities.core["message.reply"]?.status).toBe("unavailable");
    if (capabilities.core["message.reply"]?.status === "unavailable") {
      expect(capabilities.core["message.reply"].reason).toBe("session-unavailable");
    }

    expect(capabilities.extended["message.direct"]?.status).toBe("unavailable");
    if (capabilities.extended["message.direct"]?.status === "unavailable") {
      expect(capabilities.extended["message.direct"].reason).toBe("session-unavailable");
    }
  });

  it("commits next round snapshots instead of mutating previous snapshot", () => {
    const source: HorizonScenarioAdapterSource = {
      view: {
        self: { id: "bot", name: "athena" },
        environment: {
          type: "group",
          id: "room-1",
          name: "General",
          platform: "discord",
          channelId: "c1",
        },
        entities: [],
        history: [],
      },
      stimulusSource: {
        type: "message",
        messageId: "m1",
      },
    };

    const initial = createRoundContext({
      percept: {
        id: "wake-1",
        traceId: "trace-1",
        type: "mention",
        platform: "discord",
        channelId: "c1",
        timestamp: new Date(),
      },
      scenario: buildScenarioFromView(source),
      capabilities: buildCapabilitiesFromRuntime({
        session: { isDirect: false, quote: { messageId: "q1" } },
        bot: { selfId: "bot-1" },
      }),
      metadata: { phase: "before" },
      skillState: { active: ["focus"] },
    });

    const next = commitRoundContext(initial, {
      metadata: { phase: "after" },
      scenario: {
        ...initial.scenario,
        derived: {
          ...initial.scenario.derived,
          attention: { level: "high" },
        },
      },
    });

    expect(next.snapshot.version).toBe(initial.snapshot.version + 1);
    expect(initial.metadata.phase).toBe("before");
    expect(next.metadata.phase).toBe("after");
    expect(initial.snapshot).not.toBe(next.snapshot);
    expect(next.scenario).toBe(next.snapshot.scenario);
    expect(next.capabilities).toBe(next.snapshot.capabilities);
    expect(initial.scenario.derived.attention).toEqual({});
    expect(next.scenario.derived.attention).toEqual({ level: "high" });
  });

  it("binds tool runtime data to the committed round context snapshot", () => {
    const roundContext = createRoundContext({
      percept: {
        id: "wake-1",
        traceId: "trace-1",
        type: "mention",
        platform: "discord",
        channelId: "c1",
        timestamp: new Date(),
      },
      scenario: {
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
          timeline: [],
          stimulusSource: { type: "message", messageId: "m1" },
        },
        derived: {
          focus: {},
          participants: [],
          attention: {},
          recentMetrics: {},
        },
      },
      capabilities: buildCapabilitiesFromRuntime({
        session: { isDirect: false, quote: undefined },
        bot: { selfId: "bot-1" },
      }),
    });

    const bound = bindCommittedRoundContext(
      {
        platform: "discord",
        channelId: "c1",
      },
      roundContext,
    );

    expect(bound.roundContext).toBe(roundContext);
    expect(bound.scenario).toBe(roundContext.snapshot.scenario);
    expect(bound.capabilities).toBe(roundContext.snapshot.capabilities);
    expect(() => {
      (bound.scenario.derived.attention as Record<string, unknown>).level = "high";
    }).toThrow();
  });

  it("keeps ScenarioTimeline semantics as explicit runtime contract defaults", () => {
    const timeline: ScenarioTimeline = {
      turns: [],
      activeSegment: { mode: "after-latest-summary" },
      markedEvents: [],
      heartbeatEvents: [],
      semantics: DEFAULT_SCENARIO_TIMELINE_SEMANTICS,
    };

    expect(timeline.semantics.summaryPosition).toBe("background");
    expect(timeline.semantics.heartbeatRendering).toBe("query-only");
    expect(timeline.semantics.visibleOutputSource).toBe("send_message-success");
  });
});
