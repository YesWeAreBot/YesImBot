import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("skill definition contract", () => {
  it("removes legacy runtime fields from the canonical skill type", () => {
    const source = readFileSync(new URL("../src/services/skill/types.ts", import.meta.url), "utf8");

    expect(source).toContain("guidance: string");
    expect(source).toContain("allowedTools?: string[]");
    expect(source).not.toContain("conditions?:");
    expect(source).not.toContain("activate?:");
    expect(source).not.toContain("lifecycle:");
    expect(source).not.toContain("stickyTimeout");
    expect(source).not.toContain("promptFragment");
    expect(source).not.toContain("styleFragment");
    expect(source).not.toContain("effects:");
  });
});
