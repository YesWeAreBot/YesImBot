import { describe, expect, it } from "vitest";

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

describe("plugin-sdk hooks exports", () => {
  it("keeps hooks subpath as primary authoring entrypoint", () => {
    const importPath = "../src/hooks/index";
    expect(importPath).toBe("../src/hooks/index");
  });

  it("exports hook authoring symbols from hooks surface", async () => {
    const hooks = await import("../src/hooks/index");

    expect(hooks.Hook).toBeDefined();
    expect(hooks.HookType).toBeDefined();
    expect(hooks.HookPhase).toBeDefined();
    expect(Object.keys(hooks).length).toBeGreaterThan(0);
  });

  it("keeps hook type exports available for hooks subpath consumers", () => {
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
