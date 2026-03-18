import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("skill migration completeness", () => {
  it("removes non-true-skill definitions and keeps true skills", () => {
    expect(
      existsSync(new URL("../src/../resources/skills/image-gen/SKILL.md", import.meta.url)),
    ).toBe(true);
    expect(
      existsSync(new URL("../src/../resources/skills/private-chat/SKILL.md", import.meta.url)),
    ).toBe(false);
    expect(
      existsSync(new URL("../src/../resources/skills/mention-aware/SKILL.md", import.meta.url)),
    ).toBe(false);
    expect(
      existsSync(
        new URL("../src/../resources/skills/social-interactions/SKILL.md", import.meta.url),
      ),
    ).toBe(false);
    expect(
      existsSync(new URL("../src/../resources/skills/qmanager/SKILL.md", import.meta.url)),
    ).toBe(false);
    expect(
      existsSync(new URL("../src/../resources/skills/essence-mgmt/SKILL.md", import.meta.url)),
    ).toBe(false);
    expect(
      existsSync(new URL("../src/../resources/skills/forward-present/SKILL.md", import.meta.url)),
    ).toBe(false);
    expect(
      existsSync(
        new URL("../../plugins/search-service/resources/skills/search/SKILL.md", import.meta.url),
      ),
    ).toBe(true);
  });

  it("keeps search and fetch tools hidden in plugin definitions", () => {
    const pluginEntry = readFileSync(
      new URL("../../plugins/search-service/src/index.ts", import.meta.url),
      "utf8",
    );

    expect(pluginEntry).toContain('name: "search"');
    expect(pluginEntry).toContain('name: "fetch"');
    expect(pluginEntry).toMatch(/name:\s*"search"[\s\S]*?hidden:\s*true/);
    expect(pluginEntry).toMatch(/name:\s*"fetch"[\s\S]*?hidden:\s*true/);
  });
});
