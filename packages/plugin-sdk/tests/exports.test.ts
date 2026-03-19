import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { FunctionDefinition, ToolExecutionContext, ToolResult } from "../src/tools/index";

describe("plugin-sdk tools exports", () => {
  it("keeps tools subpath as primary authoring entrypoint", () => {
    const importPath = "../src/tools/index";
    expect(importPath).toBe("../src/tools/index");
  });

  it("documents canonical authoring import specifiers", () => {
    const canonicalAuthoringImports = [
      "@yesimbot/plugin-sdk/tools",
      "@yesimbot/plugin-sdk/hooks",
      "@yesimbot/plugin-sdk/skills",
    ];

    expect(canonicalAuthoringImports).toEqual([
      "@yesimbot/plugin-sdk/tools",
      "@yesimbot/plugin-sdk/hooks",
      "@yesimbot/plugin-sdk/skills",
    ]);
  });

  it("keeps root barrel as aggregate convenience over subpaths", async () => {
    const root = await import("../src/index");
    const tools = await import("../src/tools/index");
    const hooks = await import("../src/hooks/index");
    const skills = await import("../src/skills/index");

    expect(root.Tool).toBe(tools.Tool);
    expect(root.Hook).toBe(hooks.Hook);
    expect(root.SkillRegistry).toBe(skills.SkillRegistry);
  });

  it("exports self-contained tool authoring symbols from tools surface", async () => {
    const tools = await import("../src/tools/index");

    expect(tools.Tool).toBeDefined();
    expect(tools.Action).toBeDefined();
    expect(tools.Metadata).toBeDefined();
    expect(tools.defineTool).toBeDefined();
    expect(tools.defineAction).toBeDefined();
    expect(tools.withInnerThoughts).toBeDefined();
    expect(tools.YesImPlugin).toBeDefined();
    expect(tools.Success).toBeDefined();
    expect(tools.Failed).toBeDefined();
    expect(tools.FunctionType).toBeDefined();
    expect(tools.schemaToJSONSchema).toBeDefined();
    expect(tools.jsonSchemaToSchema).toBeDefined();
  });

  it("keeps type exports available for tools subpath consumers", () => {
    expectType<FunctionDefinition>();
    expectType<ToolExecutionContext>();
    expectType<ToolResult>();
  });

  it("removes deprecated core module shim declarations", () => {
    expect(
      existsSync(join(process.cwd(), "src/tools/core-plugin-modules.d.ts")),
      "tools shim should be removed",
    ).toBe(false);
    expect(
      existsSync(join(process.cwd(), "src/hooks/core-hook-modules.d.ts")),
      "hooks shim should be removed",
    ).toBe(false);
    expect(
      existsSync(join(process.cwd(), "src/skills/core-skill-modules.d.ts")),
      "skills shim should be removed",
    ).toBe(false);
  });
});

function expectType<T>(): void {
  expect(true).toBe(true);
}
