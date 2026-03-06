import { Context } from "koishi";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { HookService } from "../src/services/hook/service";
import {
  HookType,
  HookPhase,
  type HookContext,
  type BeforeHookResult,
  type HookDefinition,
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

describe("HookService", () => {
  let ctx: Context;
  let hookService: HookService;

  beforeEach(() => {
    ctx = { on: vi.fn() } as unknown as Context;
    hookService = new HookService(ctx);
  });

  it("should register hook and return disposable", () => {
    const handler = vi.fn();
    const def: HookDefinition = {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler,
    };

    const dispose = hookService.register(ctx, def);
    expect(typeof dispose).toBe("function");

    const hooks = hookService.getHooks(HookType.Tool, HookPhase.Before);
    expect(hooks).toHaveLength(1);
  });

  it("should dispose hook manually", () => {
    const handler = vi.fn();
    const def: HookDefinition = {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler,
    };

    const dispose = hookService.register(ctx, def);
    expect(hookService.getHooks(HookType.Tool, HookPhase.Before)).toHaveLength(1);

    dispose();
    expect(hookService.getHooks(HookType.Tool, HookPhase.Before)).toHaveLength(0);
  });

  it("should filter hooks by type and phase", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: handler1,
    });

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.After,
      handler: handler2,
    });

    hookService.register(ctx, {
      type: HookType.Message,
      phase: HookPhase.Before,
      handler: handler3,
    });

    expect(hookService.getHooks(HookType.Tool, HookPhase.Before)).toHaveLength(1);
    expect(hookService.getHooks(HookType.Tool, HookPhase.After)).toHaveLength(1);
    expect(hookService.getHooks(HookType.Message, HookPhase.Before)).toHaveLength(1);
  });
});
