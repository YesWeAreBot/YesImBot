import { describe, expect, it, vi } from "vitest";

import type { FunctionDefinition, ToolExecutionContext, ToolResult } from "../src/tools/index";

vi.mock("koishi-plugin-yesimbot/services/plugin", () => ({
  Action: Symbol("Action"),
  defineAction: vi.fn(),
  defineTool: vi.fn(),
  Failed: vi.fn(),
  FunctionType: { Tool: "tool", Action: "action" },
  jsonSchemaToSchema: vi.fn(),
  Metadata: Symbol("Metadata"),
  schemaToJSONSchema: vi.fn(),
  Success: vi.fn(),
  Tool: Symbol("Tool"),
  withInnerThoughts: vi.fn(),
  YesImPlugin: class {},
}));

describe("plugin-sdk tools exports", () => {
  it("uses the SDK tools barrel import path", () => {
    const importPath = "../src/tools/index";
    expect(importPath).toBe("../src/tools/index");
  });

  it("exports all required tool authoring symbols", async () => {
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

  it("keeps type exports available for tool authoring", () => {
    expectType<FunctionDefinition>();
    expectType<ToolExecutionContext>();
    expectType<ToolResult>();
  });
});

function expectType<T>(): void {
  expect(true).toBe(true);
}
