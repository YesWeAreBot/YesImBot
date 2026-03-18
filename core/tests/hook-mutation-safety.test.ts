import { Context } from "koishi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HookService } from "../src/services/hook/service";
import { HookPhase, HookType } from "../src/services/hook/types";

describe("Hook mutation safety", () => {
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

  it("timed-out hook background mutation does not leak", async () => {
    const input = { value: "start", nested: { count: 1 } };
    const baseline = structuredClone(input);

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      timeout: 50,
      handler: async (hookCtx) => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        (hookCtx.params as { nested: { count: number } }).nested.count = 99;
        return {
          modified: true,
          params: hookCtx.params as { value: string; nested: { count: number } },
        };
      },
    });

    const result = await hookService.executeBefore(HookType.Tool, input, "t-mutate-1");
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(input).toEqual(baseline);
    expect(result.params).toEqual(baseline);
  });

  it("snapshot return commits to chain, not in-place mutation", async () => {
    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: async (hookCtx) => {
        return {
          modified: true,
          params: { ...(hookCtx.params as { value: string }), extra: "added" },
        };
      },
    });

    let nextSeen: unknown;
    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: async (hookCtx) => {
        nextSeen = hookCtx.params;
        return { modified: false };
      },
    });

    const result = await hookService.executeBefore(HookType.Tool, { value: "base" }, "t-mutate-2");

    expect(result.params).toEqual({ value: "base", extra: "added" });
    expect(nextSeen).toEqual({ value: "base", extra: "added" });
  });

  it("successful hook result preserved when later hook fails", async () => {
    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: async () => ({ modified: true, params: { value: "from-A" } }),
    });

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: async () => {
        throw new Error("before failure");
      },
    });

    const result = await hookService.executeBefore(
      HookType.Tool,
      { value: "original" },
      "t-mutate-3",
    );

    expect(result.params).toEqual({ value: "from-A" });
  });

  it("all hooks throw — original params untouched", async () => {
    const input = { value: "original" };
    const baseline = structuredClone(input);

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: async () => {
        throw new Error("before-1 failed");
      },
    });
    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: async () => {
        throw new Error("before-2 failed");
      },
    });

    const result = await hookService.executeBefore(HookType.Tool, input, "t-mutate-4");

    expect(input).toEqual(baseline);
    expect(result.params).toEqual(baseline);
  });

  it("background mutation after timeout has no effect on returned params", async () => {
    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      timeout: 40,
      handler: async (hookCtx) => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        (hookCtx.params as { injected?: boolean }).injected = true;
        return { modified: true, params: hookCtx.params as { injected?: boolean } };
      },
    });

    const result = await hookService.executeBefore(HookType.Tool, { value: "base" }, "t-mutate-5");
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect((result.params as { injected?: boolean }).injected).toBeUndefined();
  });
});
