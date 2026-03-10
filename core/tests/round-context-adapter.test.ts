import { describe, expect, it } from "vitest";

import { HORIZON_SCENARIO_BOUNDARY } from "../src/services/horizon/types";
import type {
  HorizonScenarioAdapterSource,
  HorizonScenarioProjection,
} from "../src/services/horizon/types";

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

    // @ts-expect-error stimulusSource should not carry whole percept metadata bag.
    const invalidSource: HorizonScenarioAdapterSource = {
      ...source,
      stimulusSource: {
        ...source.stimulusSource,
        metadata: { fullPerceptCopy: true },
      },
    };
    expect(invalidSource).toBeTruthy();
  });
});
