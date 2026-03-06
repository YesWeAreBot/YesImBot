import { Context } from "koishi";
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  HookType,
  HookPhase,
  type HookContext,
  type BeforeHookResult,
} from "../src/services/hook/types";

describe("Hook Types", () => {
  it("should define HookType enum", () => {
    expect(HookType.Tool).toBe("tool");
    expect(HookType.Message).toBe("message");
    expect(HookType.Agent).toBe("agent");
  });

  it("should define HookPhase enum", () => {
    expect(HookPhase.Before).toBe("before");
    expect(HookPhase.After).toBe("after");
    expect(HookPhase.Error).toBe("error");
  });

  it("should support HookContext interface", () => {
    const ctx: HookContext<{ input: string }> = {
      type: HookType.Tool,
      phase: HookPhase.Before,
      params: { input: "test" },
      traceId: "trace-123",
    };
    expect(ctx.params.input).toBe("test");
  });

  it("should support BeforeHookResult discriminated union", () => {
    const modified: BeforeHookResult<{ input: string }> = {
      modified: true,
      params: { input: "changed" },
    };
    expect(modified.modified).toBe(true);

    const skip: BeforeHookResult<{ input: string }> = {
      skip: true,
      result: "skipped",
    };
    expect(skip.skip).toBe(true);

    const unmodified: BeforeHookResult<{ input: string }> = {
      modified: false,
    };
    expect(unmodified.modified).toBe(false);
  });
});
