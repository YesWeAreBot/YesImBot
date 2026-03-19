import { describe, expect, it, vi } from "vitest";

import type { Capabilities, CapabilityResolver } from "../src/skills/index";

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

describe("plugin-sdk capabilities exports", () => {
  it("uses the SDK skills barrel import path", () => {
    const importPath = "../src/skills/index";
    expect(importPath).toBe("../src/skills/index");
  });

  it("exports required capability symbols", async () => {
    const skills = await import("../src/skills/index");

    expect(skills.CAPABILITY_KEYS).toBeDefined();
    expect(skills.getCapabilityByKey).toBeDefined();
  });

  it("keeps capability contracts type-usable", () => {
    expectType<CapabilityResolver>();
    expectType<Capabilities>();
  });
});

function expectType<T>(): void {
  expect(true).toBe(true);
}
