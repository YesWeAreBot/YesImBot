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
    ctx = {
      on: vi.fn(),
      emit: vi.fn(),
      logger: vi.fn(() => ({ warn: vi.fn(), debug: vi.fn() })),
    } as unknown as Context;
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

  it("should execute before hooks and apply modifications", async () => {
    const handler = vi.fn().mockResolvedValue({
      modified: true,
      params: { input: "modified" },
    });

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler,
    });

    const result = await hookService.executeBefore(HookType.Tool, { input: "original" });

    expect(handler).toHaveBeenCalled();
    expect(result.params.input).toBe("modified");
    expect(result.skipped).toBe(false);
  });

  it("should skip execution when hook returns skip", async () => {
    const handler = vi.fn().mockResolvedValue({
      skip: true,
      result: "skipped-result",
    });

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler,
    });

    const result = await hookService.executeBefore(HookType.Tool, { input: "test" });

    expect(result.skipped).toBe(true);
    expect(result.result).toBe("skipped-result");
  });

  it("should handle hook timeout", async () => {
    const handler = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)));

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler,
      timeout: 50,
    });

    const result = await hookService.executeBefore(HookType.Tool, { input: "test" });

    expect(result.params.input).toBe("test");
  });

  it("should execute after hooks", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.After,
      handler,
    });

    await hookService.executeAfter(HookType.Tool, { input: "test" }, "result");

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: HookType.Tool,
        phase: HookPhase.After,
        params: { input: "test" },
        result: "result",
      }),
    );
  });

  it("should execute error hooks", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const error = new Error("test error");

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Error,
      handler,
    });

    await hookService.executeError(HookType.Tool, { input: "test" }, error);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: HookType.Tool,
        phase: HookPhase.Error,
        params: { input: "test" },
        error,
      }),
    );
  });
});
