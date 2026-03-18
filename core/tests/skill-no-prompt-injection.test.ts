import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("skill prompt injection removal", () => {
  it("no longer registers legacy skill effect prompt fragments in the loop", () => {
    const source = readFileSync(new URL("../src/services/agent/loop.ts", import.meta.url), "utf8");

    expect(source).not.toContain("__skill_effects_");
    expect(source).toContain("__loop_skill_catalog_");
    expect(source).toContain("renderSystemPrompt(");
  });
});
