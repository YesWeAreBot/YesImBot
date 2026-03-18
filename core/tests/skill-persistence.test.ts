import { describe, expect, it } from "vitest";

import { commitRoundContext, createRoundContext } from "../src/services/runtime/adapters";
import { inheritPersistentRoster } from "../src/services/shared/context-factory";
import type { SkillRegistry } from "../src/services/skill/service";
import type { SkillDefinition } from "../src/services/skill/types";

function createSkill(name: string): SkillDefinition {
  return {
    name,
    lifecycle: "per-turn",
    source: "plugin",
    effects: {},
  };
}

describe("skill persistence", () => {
  it("inherits persistent roster and records missing skills in load history", () => {
    const foo = createSkill("foo");
    const bar = createSkill("bar");
    const byName = new Map<string, SkillDefinition>([
      [foo.name, foo],
      [bar.name, bar],
    ]);
    const catalog = {
      get(name: string) {
        return byName.get(name);
      },
    } as unknown as SkillRegistry;

    const inherited = inheritPersistentRoster(["foo", "bar", "missing"], catalog);

    expect(inherited.size).toBe(2);
    expect(inherited.getLoadedNames()).toEqual(["foo", "bar"]);
    expect(inherited.getLoadHistory()).toEqual([
      expect.objectContaining({ name: "foo", status: "loaded" }),
      expect.objectContaining({ name: "bar", status: "loaded" }),
      expect.objectContaining({ name: "missing", status: "not_found" }),
    ]);
  });

  it("returns empty loaded set when previous roster is empty", () => {
    const catalog = { get: () => undefined } as unknown as SkillRegistry;

    const inherited = inheritPersistentRoster([], catalog);

    expect(inherited.size).toBe(0);
    expect(inherited.getLoadHistory()).toEqual([]);
  });

  it("returns empty loaded set when previous roster is undefined", () => {
    const catalog = { get: () => undefined } as unknown as SkillRegistry;

    const inherited = inheritPersistentRoster(undefined, catalog);

    expect(inherited.size).toBe(0);
    expect(inherited.getLoadHistory()).toEqual([]);
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
          timeline: {
            turns: [],
            activeSegment: { mode: "after-latest-summary" },
            markedEvents: [],
            heartbeatEvents: [],
            semantics: {
              summaryPosition: "background",
              heartbeatRendering: "query-only",
              agentResponseVisibility: "internal-draft",
              visibleOutputSource: "send_message-success",
              defaultQueryWindow: "active-segment",
            },
          },
          scenarioTimeline: {
            turns: [],
            activeSegment: { mode: "after-latest-summary" },
            markedEvents: [],
            heartbeatEvents: [],
            semantics: {
              summaryPosition: "background",
              heartbeatRendering: "query-only",
              agentResponseVisibility: "internal-draft",
              visibleOutputSource: "send_message-success",
              defaultQueryWindow: "active-segment",
            },
          },
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
