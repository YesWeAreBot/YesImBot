import { describe, expect, it } from "vitest";

import { LoadedSkillSet } from "../src/services/skill/loaded-skill-set";
import type { SkillDefinition } from "../src/services/skill/types";

function createSkill(name: string): SkillDefinition {
  return {
    name,
    description: `${name} description`,
    guidance: `${name} guidance`,
    source: "plugin",
    rootDir: `/skills/${name}`,
  };
}

describe("LoadedSkillSet", () => {
  it("loads skills idempotently and preserves first-load order", () => {
    const set = new LoadedSkillSet();
    const alpha = createSkill("alpha");
    const beta = createSkill("beta");

    expect(set.load(alpha).status).toBe("loaded");
    expect(set.load(beta).status).toBe("loaded");
    expect(set.load(alpha).status).toBe("already_loaded");

    expect(set.getLoaded().map((skill) => skill.name)).toEqual(["alpha", "beta"]);
    expect(set.getLoadedNames()).toEqual(["alpha", "beta"]);
    expect(set.has("alpha")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("tracks load history including duplicate attempts and external load attempts", () => {
    const set = new LoadedSkillSet();
    const alpha = createSkill("alpha");

    set.load(alpha);
    set.load(alpha);
    set.recordLoadAttempt("ghost", "not_found", "missing in catalog");

    expect(set.getLoadHistory()).toEqual([
      expect.objectContaining({ name: "alpha", status: "loaded" }),
      expect.objectContaining({ name: "alpha", status: "already_loaded" }),
      expect.objectContaining({ name: "ghost", status: "not_found", reason: "missing in catalog" }),
    ]);
  });

  it("unloads loaded skills and records unload history", () => {
    const set = new LoadedSkillSet();
    const alpha = createSkill("alpha");

    set.load(alpha);
    expect(set.unload("alpha")).toBe(true);
    expect(set.has("alpha")).toBe(false);
    expect(set.getLoaded()).toEqual([]);

    const history = set.getLoadHistory();
    expect(history.at(-1)).toEqual(expect.objectContaining({ name: "alpha", status: "unloaded" }));
  });
});
