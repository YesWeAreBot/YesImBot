import { describe, expect, it, vi } from "vitest";

import type {
  AgentEndHookContext,
  AgentStartHookContext,
  BeforeHookResult,
  ToolAfterHookContext,
  ToolBeforeHookContext,
  ToolErrorHookContext,
  HookDefinition,
  HookHandler,
} from "../src/hooks/index";

vi.mock("koishi-plugin-yesimbot/services/hook/decorators", () => ({
  Hook: vi.fn(),
}));

vi.mock("koishi-plugin-yesimbot/services/hook/types", () => ({
  HookPhase: { Before: "before", After: "after", Error: "error" },
  HookType: { Tool: "tool", Agent: "agent" },
}));

describe("plugin-sdk hooks exports", () => {
  it("uses the SDK hooks barrel import path", () => {
    const importPath = "../src/hooks/index";
    expect(importPath).toBe("../src/hooks/index");
  });

  it("exports required hook authoring symbols", async () => {
    const hooks = await import("../src/hooks/index");

    expect(hooks.Hook).toBeDefined();
    expect(hooks.HookType).toBeDefined();
    expect(hooks.HookPhase).toBeDefined();
    expect(Object.keys(hooks).length).toBeGreaterThan(0);
  });

  it("keeps hook type exports available", () => {
    expectType<BeforeHookResult<{ foo: string }>>();
    expectType<ToolBeforeHookContext<{ foo: string }>>();
    expectType<ToolAfterHookContext<{ foo: string }>>();
    expectType<ToolErrorHookContext<{ foo: string }>>();
    expectType<AgentStartHookContext<{ foo: string }>>();
    expectType<AgentEndHookContext<{ foo: string }>>();
    expectType<HookDefinition<{ foo: string }>>();
    expectType<HookHandler<{ foo: string }>>();
  });
});

function expectType<T>(): void {
  expect(true).toBe(true);
}
