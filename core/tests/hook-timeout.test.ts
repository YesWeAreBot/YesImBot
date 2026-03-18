import { Context } from "koishi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HookService } from "../src/services/hook/service";
import { HookPhase, HookType } from "../src/services/hook/types";

describe("Hook timeout override", () => {
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

  it("uses default timeout (3000ms) when neither call nor hook timeout is provided", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const handler = vi.fn().mockResolvedValue({ modified: false });

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler,
    });

    const result = await hookService.executeBefore(HookType.Tool, { input: "default" });

    expect(handler).toHaveBeenCalled();
    expect(result.params.input).toBe("default");
    expect(timeoutSpy.mock.calls.some((call) => call[1] === 3000)).toBe(true);
    timeoutSpy.mockRestore();
  });

  it("uses hook-level timeout when call override is absent", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const handler = vi.fn().mockResolvedValue({ modified: false });

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler,
      timeout: 1800,
    });

    const result = await hookService.executeBefore(HookType.Tool, { input: "hook-level" });

    expect(handler).toHaveBeenCalled();
    expect(result.params.input).toBe("hook-level");
    expect(timeoutSpy.mock.calls.some((call) => call[1] === 1800)).toBe(true);
    timeoutSpy.mockRestore();
  });

  it("uses call-level timeout over hook timeout for executeBefore", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const handler = vi.fn().mockResolvedValue({ modified: false });

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler,
      timeout: 5000,
    });

    const result = await hookService.executeBefore(
      HookType.Tool,
      { input: "call-level" },
      "t-1",
      120,
    );

    expect(result.params.input).toBe("call-level");
    expect(timeoutSpy.mock.calls.some((call) => call[1] === 120)).toBe(true);
    timeoutSpy.mockRestore();
  });

  it("uses call-level timeout over hook timeout for executeAfter", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
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
    expect(timeoutSpy.mock.calls.some((call) => call[1] === 100)).toBe(true);
    timeoutSpy.mockRestore();
  });

  it("uses call-level timeout over hook timeout for executeError", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
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
    expect(timeoutSpy.mock.calls.some((call) => call[1] === 100)).toBe(true);
    timeoutSpy.mockRestore();
  });

  it("times out slow hook with call-level override and preserves original params", async () => {
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
      80,
    );

    expect(result.params.input).toBe("original");
    expect(handlerCompleted).toBe(false);
  });

  it("documents precedence contract as call override > hook timeout > default timeout", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const handler = vi.fn().mockResolvedValue({ modified: false });

    hookService.register(ctx, {
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler,
      timeout: 900,
    });

    await hookService.executeBefore(HookType.Tool, { input: "call-wins" }, "t-call", 120);
    await hookService.executeBefore(HookType.Tool, { input: "hook-wins" }, "t-hook");

    const defaultHook = vi.fn().mockResolvedValue({ modified: false });
    hookService.register(ctx, {
      type: HookType.Message,
      phase: HookPhase.Before,
      handler: defaultHook,
    });
    await hookService.executeBefore(HookType.Message, { content: "default-wins" }, "t-default");

    expect(timeoutSpy.mock.calls.some((call) => call[1] === 120)).toBe(true);
    expect(timeoutSpy.mock.calls.some((call) => call[1] === 900)).toBe(true);
    expect(timeoutSpy.mock.calls.some((call) => call[1] === 1000)).toBe(true);
    timeoutSpy.mockRestore();
  });
});
