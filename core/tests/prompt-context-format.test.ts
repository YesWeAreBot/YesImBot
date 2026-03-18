import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("AGENTS.md context format docs", () => {
  it("documents timeline, tool-call format, and dynamic variables", () => {
    const content = readFileSync(new URL("../resources/roles/AGENTS.md", import.meta.url), "utf8");

    expect(content).toContain("## Context Format");
    expect(content).toContain("<msg");
    expect(content).toContain("request_heartbeat");
    expect(content).toContain("{{bot.name}}");
  });
});
