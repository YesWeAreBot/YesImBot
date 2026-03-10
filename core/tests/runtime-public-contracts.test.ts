import { describe, expect, it } from "vitest";

import { HookPhase, HookType } from "../src/services/hook/types";
import type { HookExecutionContext } from "../src/services/hook/types";
import type { ToolExecutionContext } from "../src/services/plugin/types";
import type { Capabilities, RoundContext, Scenario } from "../src/services/runtime/contracts";

describe("runtime public contracts", () => {
  it("tool and hook context contracts", () => {
    const scenario = {} as Scenario;
    const capabilities = {} as Capabilities;
    const roundContext = {} as RoundContext;

    const toolCtx: ToolExecutionContext = {
      platform: "discord",
      channelId: "c1",
      scenario,
      capabilities,
      roundContext,
    };

    const hookCtx: HookExecutionContext = {
      ...toolCtx,
      hookType: HookType.Tool,
      hookPhase: HookPhase.Before,
    };

    expect(toolCtx.platform).toBe("discord");
    expect(hookCtx.hookType).toBe(HookType.Tool);
  });
});
