import { Context } from "koishi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HookService } from "../src/services/hook/service";
import { HookPhase, HookType } from "../src/services/hook/types";

describe("Hook lifecycle events", () => {
  let ctx: Context;
  let hookService: HookService;
  let emitSpy: ReturnType<typeof vi.fn>;
  let debugSpy: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    emitSpy = vi.fn();
    debugSpy = vi.fn();
    warnSpy = vi.fn();
    ctx = {
      on: vi.fn(),
      emit: emitSpy,
      logger: vi.fn(() => ({ debug: debugSpy, warn: warnSpy })),
    } as unknown as Context;
    hookService = new HookService(ctx, {
      hookTimeouts: { tool: 100, message: 110, agent: 120 },
    });
  });

  it("emits hook.registered event on register()", () => {
    hookService.register(ctx, {
      id: "hook-1",
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: vi.fn(),
      metadata: { source: "unit-test" },
    });

    expect(emitSpy).toHaveBeenCalledWith(
      "athena:hook.registered",
      "hook-1",
      HookType.Tool,
      HookPhase.Before,
      "unit-test",
    );
  });

  it("emits hook.started before handler executes", async () => {
    const handler = vi.fn().mockResolvedValue({ modified: false });
    hookService.register(ctx, {
      id: "hook-2",
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler,
    });

    await hookService.executeBefore(HookType.Tool, { input: "x" }, "trace-1");

    const startedIndex = emitSpy.mock.calls.findIndex(([event]) => event === "athena:hook.started");
    const startedOrder = emitSpy.mock.invocationCallOrder[startedIndex];
    const handlerOrder = handler.mock.invocationCallOrder[0];

    expect(startedIndex).toBeGreaterThanOrEqual(0);
    expect(startedOrder).toBeLessThan(handlerOrder);
  });

  it("emits hook.completed on success with duration and outcome", async () => {
    hookService.register(ctx, {
      id: "hook-3",
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: vi.fn().mockResolvedValue({ modified: false }),
    });

    await hookService.executeBefore(HookType.Tool, { input: "ok" }, "trace-2");

    const completedCall = emitSpy.mock.calls.find(([event]) => event === "athena:hook.completed");

    expect(completedCall).toBeTruthy();
    if (!completedCall) return;

    const [, hookId, hookType, hookPhase, traceId, durationMs, outcome] = completedCall;
    expect(hookId).toBe("hook-3");
    expect(hookType).toBe(HookType.Tool);
    expect(hookPhase).toBe(HookPhase.Before);
    expect(traceId).toBe("trace-2");
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(outcome).toBe("success");
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining("hook-3"),
      expect.objectContaining({
        hookId: "hook-3",
        hookType: HookType.Tool,
        hookPhase: HookPhase.Before,
        traceId: "trace-2",
      }),
    );
  });

  it("emits hook.failed on timeout with reason 'timeout'", async () => {
    hookService.register(ctx, {
      id: "hook-4",
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200))),
    });

    await hookService.executeBefore(HookType.Tool, { input: "slow" }, "trace-3", 20);

    const failedCall = emitSpy.mock.calls.find(
      ([event, hookId]) => event === "athena:hook.failed" && hookId === "hook-4",
    );

    expect(failedCall).toBeTruthy();
    if (!failedCall) return;

    const [, , , , traceId, durationMs, reason] = failedCall;
    expect(traceId).toBe("trace-3");
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(reason).toBe("timeout");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("hook-4"),
      expect.objectContaining({
        hookId: "hook-4",
        hookType: HookType.Tool,
        hookPhase: HookPhase.Before,
        traceId: "trace-3",
        reason: "timeout",
      }),
    );
  });

  it("emits hook.failed on handler error with reason message", async () => {
    hookService.register(ctx, {
      id: "hook-5",
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: vi.fn().mockRejectedValue(new Error("boom")),
    });

    await hookService.executeBefore(HookType.Tool, { input: "err" }, "trace-4");

    const failedCall = emitSpy.mock.calls.find(
      ([event, hookId]) => event === "athena:hook.failed" && hookId === "hook-5",
    );

    expect(failedCall).toBeTruthy();
    if (!failedCall) return;

    const [, , , , traceId, durationMs, reason] = failedCall;
    expect(traceId).toBe("trace-4");
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(reason).toContain("boom");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("hook-5"),
      expect.objectContaining({
        hookId: "hook-5",
        hookType: HookType.Tool,
        hookPhase: HookPhase.Before,
        traceId: "trace-4",
      }),
    );
  });

  it("uses config-driven timeout per hook type and precedence", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");

    hookService.register(ctx, {
      id: "hook-6",
      type: HookType.Tool,
      phase: HookPhase.Before,
      handler: vi.fn().mockResolvedValue({ modified: false }),
    });

    hookService.register(ctx, {
      id: "hook-7",
      type: HookType.Message,
      phase: HookPhase.Before,
      handler: vi.fn().mockResolvedValue({ modified: false }),
    });

    hookService.register(ctx, {
      id: "hook-8",
      type: HookType.Agent,
      phase: HookPhase.Before,
      handler: vi.fn().mockResolvedValue({ modified: false }),
      timeout: 50,
    });

    await hookService.executeBefore(HookType.Tool, { input: "tool" }, "t-tool");
    await hookService.executeBefore(HookType.Message, { input: "msg" }, "t-msg");
    await hookService.executeBefore(HookType.Agent, { input: "agent" }, "t-agent");
    await hookService.executeBefore(HookType.Agent, { input: "override" }, "t-ovr", 20);

    const timeoutValues = timeoutSpy.mock.calls.map((call) => call[1]);
    expect(timeoutValues).toEqual(expect.arrayContaining([100, 110, 50, 20]));
    timeoutSpy.mockRestore();
  });
});
