import { describe, expect, it } from "vitest";

import { SkillEffectApplier } from "../src/services/skill/applier";
import { LoadedSkillSet } from "../src/services/skill/loaded-skill-set";
import type { SkillDefinition } from "../src/services/skill/types";

function createSkill(
  overrides: Partial<SkillDefinition> & Pick<SkillDefinition, "name">,
): SkillDefinition {
  return {
    name: overrides.name,
    lifecycle: "per-turn",
    source: "plugin",
    effects: {},
    ...overrides,
  };
}

describe("SkillEffectApplier", () => {
  it("returns empty effects for an empty loaded set", () => {
    const applier = new SkillEffectApplier();
    const effects = applier.apply(new LoadedSkillSet());

    expect(effects.promptFragments).toEqual([]);
    expect(effects.styleFragment).toBeNull();
    expect(effects.toolVisibility).toEqual({ include: [], exclude: [] });
    expect(effects.metadata.loadedSkills).toEqual([]);
    expect(effects.metadata.loadHistory).toEqual([]);
  });

  it("materializes prompt fragments and merges tool visibility", () => {
    const set = new LoadedSkillSet();
    set.load(
      createSkill({
        name: "alpha",
        effects: {
          prompt: "Alpha prompt",
          tools: { include: ["tool-a"], exclude: ["tool-x"] },
        },
      }),
    );
    set.load(
      createSkill({
        name: "beta",
        promptFragment: { section: "policy", priority: 410, stability: "stable", cacheable: true },
        effects: {
          prompt: "Beta prompt",
          tools: { include: ["tool-b"], exclude: ["tool-y"] },
        },
      }),
    );

    const applier = new SkillEffectApplier();
    const effects = applier.apply(set);

    expect(effects.promptFragments).toHaveLength(2);
    expect(effects.promptFragments[0]).toMatchObject({
      id: "skill.alpha.prompt",
      section: "situation",
      source: "skill",
      priority: 400,
      stability: "dynamic",
      cacheable: false,
    });
    expect(effects.promptFragments[1]).toMatchObject({
      id: "skill.beta.prompt",
      section: "policy",
      source: "skill",
      priority: 410,
      stability: "stable",
      cacheable: true,
    });

    expect(effects.toolVisibility).toEqual({
      include: ["tool-a", "tool-b"],
      exclude: ["tool-x", "tool-y"],
    });
  });

  it("picks the style fragment with highest specificity and reports metadata", () => {
    const set = new LoadedSkillSet();
    set.load(
      createSkill({
        name: "low-specificity",
        conditions: { match: { dimension: "mood", value: "calm" } },
        effects: {
          style: { content: "Low style" },
        },
      }),
    );
    set.load(
      createSkill({
        name: "high-specificity",
        conditions: {
          and: [
            { match: { dimension: "mood", value: "calm" } },
            { match: { dimension: "scene", value: "focus" } },
          ],
        },
        styleFragment: { section: "policy", priority: 700, stability: "stable", cacheable: true },
        effects: {
          style: { content: "High style" },
        },
      }),
    );
    set.load(createSkill({ name: "noop" }));

    const applier = new SkillEffectApplier();
    const effects = applier.apply(set);

    expect(effects.styleFragment).toMatchObject({
      id: "skill.high-specificity.style",
      content: "High style",
      section: "policy",
      priority: 700,
      stability: "stable",
      cacheable: true,
    });

    expect(effects.metadata.loadedSkills).toEqual(["low-specificity", "high-specificity", "noop"]);
    expect(effects.metadata.loadHistory.map((attempt) => attempt.status)).toEqual([
      "loaded",
      "loaded",
      "loaded",
    ]);
  });
});
