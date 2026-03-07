import { Context } from "koishi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HookService } from "../src/services/hook/service";
import { HookPhase, HookType } from "../src/services/hook/types";

describe("Hook error isolation", () => {
  let ctx: Context;
  let hookService: HookService;
  let warnSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    warnSpy = vi.fn();
    ctx = {
      on: vi.fn(),
      logger: vi.fn(() => ({ warn: warnSpy })),
    } as unknown as Context;

    hookService = new HookService(ctx);
    (hookService as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger = {
      warn: warnSpy,
    };
  });

  it("continues to later before hooks when an earlier before hook throws", async () => {
    const order: string[] = [];

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: async () => {
        order.push("before-1");
        throw new Error("before failed");
      },
    });

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: async (hookCtx) => {
        order.push("before-2");
        return {
          modified: true,
          params: { ...(hookCtx.params as { input: string }), input: "updated" },
        };
      },
    });

    const result = await hookService.executeBefore(HookType.Tool, { input: "original" }, "t-1");

    expect(order).toEqual(["before-1", "before-2"]);
    expect(result.skipped).toBe(false);
    expect(result.params).toEqual({ input: "updated" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("continues to later after hooks when an earlier after hook throws", async () => {
    const order: string[] = [];

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.After,
      handler: async () => {
        order.push("after-1");
        throw new Error("after failed");
      },
    });

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.After,
      handler: async () => {
        order.push("after-2");
      },
    });

    await hookService.executeAfter(HookType.Tool, { input: "v" }, { ok: true }, "t-2");

    expect(order).toEqual(["after-1", "after-2"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("continues to later error hooks when an earlier error hook throws", async () => {
    const order: string[] = [];

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Error,
      handler: async () => {
        order.push("error-1");
        throw new Error("error hook failed");
      },
    });

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Error,
      handler: async () => {
        order.push("error-2");
      },
    });

    await hookService.executeError(HookType.Tool, { input: "v" }, new Error("upstream"), "t-3");

    expect(order).toEqual(["error-1", "error-2"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
