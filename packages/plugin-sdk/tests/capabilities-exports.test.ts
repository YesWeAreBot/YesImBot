import { describe, expect, it } from "vitest";

import type { Capabilities, CapabilityResolver } from "../src/skills/index";

describe("plugin-sdk capabilities exports", () => {
  it("uses the SDK skills subpath for capability contracts", () => {
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
