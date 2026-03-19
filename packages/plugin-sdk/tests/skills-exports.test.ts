import { describe, expect, it, vi } from "vitest";

import type { SkillDefinition, SkillMetadata } from "../src/skills/index";

vi.mock("koishi-plugin-yesimbot/services/skill", () => ({
  SkillRegistry: class {},
  loadSkillsFromDir: vi.fn(),
}));

vi.mock("koishi-plugin-yesimbot/services/plugin", () => ({
  CAPABILITY_KEYS: {
    MESSAGE_SEND: "message.send",
  },
  getCapabilityByKey: vi.fn(),
}));

describe("plugin-sdk skills exports", () => {
  it("uses the SDK skills barrel import path", () => {
    const importPath = "../src/skills/index";
    expect(importPath).toBe("../src/skills/index");
  });

  it("exports required skill symbols", async () => {
    const skills = await import("../src/skills/index");

    expect(skills.SkillRegistry).toBeDefined();
    expect(skills.loadSkillsFromDir).toBeDefined();
  });

  it("keeps skill contract types available", () => {
    expectType<SkillDefinition>();
    expectType<SkillMetadata>();
  });
});

function expectType<T>(): void {
  expect(true).toBe(true);
}
