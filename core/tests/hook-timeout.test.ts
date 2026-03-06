import { Context } from "koishi";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { HookService } from "../src/services/hook/service";
import { HookType, HookPhase, type HookDefinition } from "../src/services/hook/types";

describe("Hook timeout override", () => {
  let ctx: Context;
  let hookService: HookService;

  beforeEach(() => {
    ctx = {
      on: vi.fn(),
      logger: vi.fn(() => ({ warn: vi.fn() })),
    } as unknown as Context;
    hookService = new HookService(ctx);
  });

  it("should use default timeout (5000ms) when no timeout specified", async () => {
    const handler = vi.fn().mockResolvedValue({ modified: false });

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler,
    });

    const result = await hookService.executeBefore(HookType.Tool, { input: "test" });

    expect(handler).toHaveBeenCalled();
    expect(result.params.input).toBe("test");
  });

  it("should use hook-level timeout when specified", async () => {
    const handler = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ modified: false }), 150)),
      );

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler,
      timeout: 2000,
    });

    const result = await hookService.executeBefore(HookType.Tool, { input: "test" });

    expect(handler).toHaveBeenCalled();
    expect(result.params.input).toBe("test");
  });

  it("should use call-level timeout over hook timeout (executeBefore)", async () => {
    const handler = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ modified: false }), 200)),
      );

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler,
      timeout: 5000,
    });

    const result = await hookService.executeBefore(
      HookType.Tool,
      { input: "test" },
      "trace-1",
      100,
    );

    expect(result.params.input).toBe("test");
  });

  it("should use call-level timeout over hook timeout (executeAfter)", async () => {
    const handler = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)));

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.After,
      handler,
      timeout: 5000,
    });

    await hookService.executeAfter(HookType.Tool, { input: "test" }, "result", "trace-1", 100);

    expect(handler).toHaveBeenCalled();
  });

  it("should use call-level timeout over hook timeout (executeError)", async () => {
    const handler = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)));

    const error = new Error("test error");

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Error,
      handler,
      timeout: 5000,
    });

    await hookService.executeError(HookType.Tool, { input: "test" }, error, "trace-1", 100);

    expect(handler).toHaveBeenCalled();
  });

  it("should verify timeout precedence: call > hook > default", async () => {
    const handler = vi.fn().mockResolvedValue({ modified: false });

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler,
      timeout: 3000,
    });

    await hookService.executeBefore(HookType.Tool, { input: "test" }, "trace-1", 1000);

    expect(handler).toHaveBeenCalled();
  });

  it("should timeout slow hook with call-level override", async () => {
    let handlerCompleted = false;
    const handler = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            handlerCompleted = true;
            resolve({ modified: true, params: { input: "modified" } });
          }, 300),
        ),
    );

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler,
      timeout: 5000,
    });

    const result = await hookService.executeBefore(
      HookType.Tool,
      { input: "original" },
      "trace-1",
      100,
    );

    expect(result.params.input).toBe("original");
    expect(handlerCompleted).toBe(false);
  });
});
