import { Context } from "koishi";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { Hook } from "../src/services/hook/decorators";
import { HookService } from "../src/services/hook/service";
import {
  HookType,
  HookPhase,
  type HookContext,
  type BeforeHookResult,
} from "../src/services/hook/types";

describe("Hook Decorator", () => {
  let ctx: Context;
  let hookService: HookService;

  beforeEach(() => {
    ctx = new Context();
    ctx.on = (() => () => true) as unknown as typeof ctx.on;
    (ctx as unknown as { emit: (...args: unknown[]) => void }).emit = () => undefined;
    (ctx as unknown as { logger: (name: string) => Record<string, unknown> }).logger = () => ({
      warn: () => undefined,
      debug: () => undefined,
      info: () => undefined,
      level: 2,
    });
    hookService = new HookService(ctx);
  });

  afterEach(() => {
    // No dispose needed for mock context
  });

  it("should register hooks from decorated methods", () => {
    class TestPlugin {
      callCount = 0;

      @Hook({ type: HookType.Tool, phase: HookPhase.Before })
      async beforeToolHook(_hookCtx: HookContext): Promise<BeforeHookResult<unknown>> {
        this.callCount++;
        return { modified: false };
      }
    }

    const plugin = new TestPlugin();
    hookService.registerFromDecorators(ctx, plugin);

    const hooks = hookService.getHooks(HookType.Tool, HookPhase.Before);
    expect(hooks).toHaveLength(1);
  });

  it("should execute decorated hook with correct context binding", async () => {
    class TestPlugin {
      callCount = 0;

      @Hook({ type: HookType.Tool, phase: HookPhase.Before })
      async beforeToolHook(_hookCtx: HookContext): Promise<BeforeHookResult<unknown>> {
        this.callCount++;
        return { modified: false };
      }
    }

    const plugin = new TestPlugin();
    hookService.registerFromDecorators(ctx, plugin);

    await hookService.executeBefore(HookType.Tool, { test: "data" });

    expect(plugin.callCount).toBe(1);
  });

  it("should support multiple decorated hooks", () => {
    class TestPlugin {
      @Hook({ type: HookType.Tool, phase: HookPhase.Before })
      async beforeToolHook(_hookCtx: HookContext): Promise<BeforeHookResult<unknown>> {
        return { modified: false };
      }

      @Hook({ type: HookType.Tool, phase: HookPhase.After })
      async afterToolHook(_hookCtx: HookContext): Promise<void> {
        // After hook
      }
    }

    const plugin = new TestPlugin();
    hookService.registerFromDecorators(ctx, plugin);

    expect(hookService.getHooks(HookType.Tool, HookPhase.Before)).toHaveLength(1);
    expect(hookService.getHooks(HookType.Tool, HookPhase.After)).toHaveLength(1);
  });

  it("should support all hook phases", () => {
    class TestPlugin {
      @Hook({ type: HookType.Tool, phase: HookPhase.Before })
      async beforeHook(_hookCtx: HookContext): Promise<BeforeHookResult<unknown>> {
        return { modified: false };
      }

      @Hook({ type: HookType.Tool, phase: HookPhase.After })
      async afterHook(_hookCtx: HookContext): Promise<void> {
        // After hook
      }

      @Hook({ type: HookType.Tool, phase: HookPhase.Error })
      async errorHook(_hookCtx: HookContext): Promise<void> {
        // Error hook
      }
    }

    const plugin = new TestPlugin();
    hookService.registerFromDecorators(ctx, plugin);

    expect(hookService.getHooks(HookType.Tool, HookPhase.Before)).toHaveLength(1);
    expect(hookService.getHooks(HookType.Tool, HookPhase.After)).toHaveLength(1);
    expect(hookService.getHooks(HookType.Tool, HookPhase.Error)).toHaveLength(1);
  });

  it("should pass timeout option to registered hook", async () => {
    class TestPlugin {
      @Hook({ type: HookType.Tool, phase: HookPhase.Before, timeout: 1000 })
      async slowHook(_hookCtx: HookContext): Promise<BeforeHookResult<unknown>> {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return { modified: false };
      }
    }

    const plugin = new TestPlugin();
    hookService.registerFromDecorators(ctx, plugin);

    const start = Date.now();
    await hookService.executeBefore(HookType.Tool, { test: "data" });
    const duration = Date.now() - start;

    // Should timeout around 1000ms, not wait full 2000ms
    expect(duration).toBeLessThan(1500);
  });

  it("should pass metadata option to registered hook", () => {
    const metadata = { author: "test", version: "1.0" };

    class TestPlugin {
      @Hook({ type: HookType.Tool, phase: HookPhase.Before, metadata })
      async metadataHook(_hookCtx: HookContext): Promise<BeforeHookResult<unknown>> {
        return { modified: false };
      }
    }

    const plugin = new TestPlugin();
    hookService.registerFromDecorators(ctx, plugin);

    const hooks = hookService.getHooks(HookType.Tool, HookPhase.Before);
    expect(hooks[0].metadata).toEqual(metadata);
  });

  it("should auto-cleanup decorated hooks on context dispose", () => {
    const childCtx = new Context();
    const disposeCallbacks: Array<() => void> = [];
    childCtx.on = (event: string, callback: () => void) => {
      if (event === "dispose") {
        disposeCallbacks.push(callback);
      }
    };

    class TestPlugin {
      @Hook({ type: HookType.Tool, phase: HookPhase.Before })
      async beforeHook(_hookCtx: HookContext): Promise<BeforeHookResult<unknown>> {
        return { modified: false };
      }
    }

    const plugin = new TestPlugin();
    hookService.registerFromDecorators(childCtx, plugin);

    expect(hookService.getHooks(HookType.Tool, HookPhase.Before)).toHaveLength(1);

    // Simulate dispose
    disposeCallbacks.forEach((cb) => cb());

    expect(hookService.getHooks(HookType.Tool, HookPhase.Before)).toHaveLength(0);
  });

  it("should handle instance with no decorated hooks", () => {
    class TestPlugin {
      regularMethod() {
        return "not a hook";
      }
    }

    const plugin = new TestPlugin();
    hookService.registerFromDecorators(ctx, plugin);

    expect(hookService.getHooks(HookType.Tool, HookPhase.Before)).toHaveLength(0);
  });

  it("should allow hook to modify params", async () => {
    class TestPlugin {
      @Hook({ type: HookType.Tool, phase: HookPhase.Before })
      async modifyHook(
        hookCtx: HookContext<{ value: number }>,
      ): Promise<BeforeHookResult<{ value: number }>> {
        return { modified: true, params: { value: hookCtx.params.value * 2 } };
      }
    }

    const plugin = new TestPlugin();
    hookService.registerFromDecorators(ctx, plugin);

    const result = await hookService.executeBefore(HookType.Tool, { value: 5 });

    expect(result.params.value).toBe(10);
    expect(result.skipped).toBe(false);
  });

  it("should allow hook to skip execution", async () => {
    class TestPlugin {
      @Hook({ type: HookType.Tool, phase: HookPhase.Before })
      async skipHook(_hookCtx: HookContext): Promise<BeforeHookResult<unknown>> {
        return { skip: true, result: "skipped" };
      }
    }

    const plugin = new TestPlugin();
    hookService.registerFromDecorators(ctx, plugin);

    const result = await hookService.executeBefore(HookType.Tool, { test: "data" });

    expect(result.skipped).toBe(true);
    expect(result.result).toBe("skipped");
  });
});
