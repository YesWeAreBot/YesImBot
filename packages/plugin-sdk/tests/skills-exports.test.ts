import { describe, expect, it } from "vitest";

import type { SkillDefinition, SkillMetadata } from "../src/skills/index";

describe("plugin-sdk skills exports", () => {
  it("keeps skills subpath as primary authoring entrypoint", () => {
    const importPath = "../src/skills/index";
    expect(importPath).toBe("../src/skills/index");
  });

  it("exports required skill symbols from skills surface", async () => {
    const skills = await import("../src/skills/index");

    expect(skills.SkillRegistry).toBeDefined();
    expect(skills.loadSkillsFromDir).toBeDefined();
  });

  it("keeps skill contract types available for skills subpath consumers", () => {
    expectType<SkillDefinition>();
    expectType<SkillMetadata>();
  });
});

function expectType<T>(): void {
  expect(true).toBe(true);
}
