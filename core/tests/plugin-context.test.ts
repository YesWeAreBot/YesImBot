import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const typesPath = path.resolve(__dirname, "../src/services/plugin/types.ts");

describe("plugin sdk context contracts", () => {
  it("ToolExecutionContext keeps canonical fields", () => {
    const source = readFileSync(typesPath, "utf8");
    expect(source).toContain("roundContext?: RoundContext;");
    expect(source).toContain("scenario?: Scenario;");
    expect(source).toContain("capabilities?: Capabilities;");
  });

  it("RuntimeToolExecutionContext carries runtime-only fields", () => {
    const source = readFileSync(typesPath, "utf8");
    expect(source).toContain(
      "export interface RuntimeToolExecutionContext extends ToolExecutionContext",
    );
    expect(source).toContain("skills?: ActiveSkill[];");
    expect(source).toContain("view?: HorizonView;");
    expect(source).not.toContain("traits?:");
    expect(source).not.toContain("TraitSignal");
  });
});
