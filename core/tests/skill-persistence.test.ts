import { describe, expect, it, vi } from "vitest";

import { commitRoundContext, createRoundContext } from "../src/runtime/adapters";
import { DEFAULT_SCENARIO_TIMELINE_SEMANTICS } from "../src/runtime/contracts";
import { buildAgentRoundContext } from "../src/shared/context-factory";
import { projectSkillState, type AgentSessionState } from "../src/services/skill/session-store";
import type { LoadAttempt } from "../src/services/skill/types";

function createScenarioTimeline() {
  return {
    turns: [],
    activeSegment: { mode: "after-latest-summary" as const },
    markedEvents: [],
    heartbeatEvents: [],
    semantics: DEFAULT_SCENARIO_TIMELINE_SEMANTICS,
  };
}

describe("skill persistence", () => {
  it("projects persistent roster from session state", () => {
    const loadHistory: LoadAttempt[] = [
      { name: "foo", status: "loaded", timestamp: 1 },
      { name: "missing", status: "not_found", timestamp: 2 },
    ];
    const state: AgentSessionState = {
      loadedSkills: ["foo", "bar"],
      loadHistory,
    };

    expect(projectSkillState(state)).toEqual({
      active: ["foo", "bar"],
      loadHistory,
      persistentRoster: ["foo", "bar"],
    });
  });

  it("hydrates round context with persisted skill state", async () => {
    const sessionState: AgentSessionState = {
      loadedSkills: ["search"],
      loadHistory: [{ name: "search", status: "loaded", timestamp: 10 }],
    };
    const ctx = {
      logger: vi.fn(() => ({ warn: vi.fn() })),
      "yesimbot.session": {
        getState: vi.fn(() => sessionState),
      },
      "yesimbot.skill": {
        get: vi.fn(() => undefined),
      },
      "yesimbot.horizon": {
        buildView: vi.fn().mockResolvedValue({
          self: { id: "bot", name: "Athena" },
          environment: {
            type: "group",
            id: "c1",
            name: "General",
            platform: "discord",
            channelId: "c1",
          },
          entities: [],
          history: [],
        }),
      },
    } as never;

    const built = await buildAgentRoundContext(ctx, {
      platform: "discord",
      channelId: "c1",
      percept: {
        id: "wake-1",
        traceId: "trace-1",
        type: "mention",
        platform: "discord",
        channelId: "c1",
        timestamp: new Date("2026-03-10T00:00:00Z"),
      },
    });

    expect(built.roundContext.skillState).toEqual(projectSkillState(sessionState));
  });

  it("commitRoundContext preserves loadHistory and persistentRoster", () => {
    const round = createRoundContext({
      percept: {
        id: "wake-1",
        traceId: "trace-1",
        type: "mention",
        platform: "discord",
        channelId: "c1",
        timestamp: new Date("2026-03-10T00:00:00Z"),
      },
      scenario: {
        raw: {
          self: { id: "bot", name: "Athena" },
          environment: {
            type: "group",
            id: "c1",
            name: "General",
            platform: "discord",
            channelId: "c1",
          },
          entities: [],
          timeline: createScenarioTimeline(),
          scenarioTimeline: createScenarioTimeline(),
          stimulusSource: { type: "message" },
        },
        derived: {
          focus: {},
          participants: [],
          attention: {},
          recentMetrics: {},
        },
      },
      capabilities: {
        core: {
          sendMessage: { status: "available" },
          readHistory: { status: "available" },
        },
        extended: {},
      },
      skillState: {
        active: ["foo"],
      },
    });

    const committed = commitRoundContext(round, {
      skillState: {
        active: ["foo", "bar"],
        loadHistory: [
          { name: "foo", status: "loaded", timestamp: Date.now() },
          { name: "bar", status: "loaded", timestamp: Date.now() },
        ],
        persistentRoster: ["foo", "bar"],
      },
    });

    expect(committed.skillState.loadHistory?.length).toBe(2);
    expect(committed.skillState.persistentRoster).toEqual(["foo", "bar"]);
  });
});
