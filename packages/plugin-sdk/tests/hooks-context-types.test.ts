import { describe, expect, it } from "vitest";

import type {
  AgentStartHookContext,
  BeforeHookResult,
  ToolBeforeHookContext,
} from "../src/hooks/index";

describe("plugin-sdk hooks context types", () => {
  it("exposes canonical public hook context fields", () => {
    type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
    type ToolCtx = ToolBeforeHookContext<{ value: number }>;

    const roundContext = {} as ToolCtx["roundContext"];
    const scenario = {} as ToolCtx["scenario"];
    const capabilities = {} as ToolCtx["capabilities"];

    expect(roundContext).toBeDefined();
    expect(scenario).toBeDefined();
    expect(capabilities).toBeDefined();

    expectFalse<HasKey<ToolCtx, "traits">>();
    expectFalse<HasKey<ToolCtx, "view">>();
    expectFalse<HasKey<ToolCtx, "skills">>();
  });

  it("keeps explicit modify/skip before-hook result semantics", () => {
    const modified: BeforeHookResult<{ value: number }> = {
      modified: true,
      params: { value: 2 },
    };
    const skipped: BeforeHookResult<{ value: number }> = {
      skip: true,
      result: "stop",
    };
    const unchanged: BeforeHookResult<{ value: number }> = { modified: false };

    expect(modified.modified).toBe(true);
    expect(skipped.skip).toBe(true);
    expect(unchanged.modified).toBe(false);

    type AgentSkip = BeforeHookResult<AgentStartHookContext<{ intent: string }>>;
    const agentSkip: AgentSkip = {
      skip: true,
      result: { reason: "policy" },
    };

    expect(agentSkip.skip).toBe(true);
  });
});

function expectFalse<T extends false>(): void {
  expect(true).toBe(true);
}
