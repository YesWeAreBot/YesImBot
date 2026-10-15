import { Schema } from "koishi";
import { afterEach, expect, it, vi } from "vitest";

import { guardReplySession, withReplyTurn } from "../src/agent/reply-turn";
import { ToolService } from "../src/extension/service";

function fixture(execute: (args: any) => Promise<any>, retry = 0, record?: (event: any) => Promise<any>) {
    const events: any[] = [];
    const errors: any[] = [];
    const service = {
        getTool: () => ({ parameters: Schema.object({}), execute }),
        _logger: { info() {}, warn() {}, success() {}, debug() {}, error: (...args: any[]) => errors.push(args) },
        config: { advanced: { maxRetry: retry, retryDelay: 60_000 } },
        executeInvocation: ToolService.prototype["executeInvocation"],
        deps: { world: { recordSystemEvent: record ?? (async (event: any) => events.push(event)) } },
    } as unknown as ToolService;
    return { invoke: (session?: any) => ToolService.prototype.invoke.call(service, "probe", {}, session), events, errors };
}
afterEach(() => vi.useRealTimers());

it("releases a cancelled invocation without waiting for a tool and guards its late send", async () => {
    const controller = new AbortController();
    let release!: () => void;
    let ready!: () => void;
    const started = new Promise<void>((resolve) => (ready = resolve));
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const deliveries: string[] = [];
    let late!: Promise<any>;
    const tool = fixture(({ session }) => {
        late = (async () => {
            ready();
            await blocked;
            await session.send("stale");
            return { status: "success" };
        })();
        return late;
    });
    const session = { platform: "onebot", channelId: "g", bot: {}, send: async (text: string) => deliveries.push(text) };
    const invocation = withReplyTurn(
        () => true,
        () => tool.invoke(guardReplySession(session as any)),
        controller.signal,
    );
    const outcome = invocation.then(
        () => "completed",
        () => "cancelled",
    );
    await started;
    controller.abort();
    await Promise.resolve();
    // A blocked, non-cooperating extension must not retain the channel's running task.
    expect(await Promise.race([outcome, new Promise((resolve) => setTimeout(() => resolve("blocked"), 20))])).toBe("cancelled");
    release();
    await expect(late).rejects.toThrow("聊天任务已取消");
    expect(deliveries).toEqual([]);
    expect(tool.events).toEqual([]);
    expect(tool.errors).toEqual([]);
});

it("clears a tool retry delay immediately on cancellation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let calls = 0;
    const tool = fixture(async () => {
        calls++;
        return { status: "error", error: { message: "retry", retryable: true } };
    }, 2);
    const outcome = withReplyTurn(
        () => !controller.signal.aborted,
        () => tool.invoke(),
        controller.signal,
    ).catch(() => "cancelled");
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    expect(await outcome).toBe("cancelled");
    expect(vi.getTimerCount()).toBe(0);
    expect(calls).toBe(1);
    expect(tool.errors).toEqual([]);
});

it("does not cancel another channel's concurrent tool invocation", async () => {
    const cancelled = new AbortController();
    const healthy = new AbortController();
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => (finish = resolve));
    const tool = fixture(async () => {
        await waiting;
        return { status: "success", result: "healthy" };
    });
    const old = withReplyTurn(
        () => true,
        () => tool.invoke(),
        cancelled.signal,
    ).catch(() => "cancelled");
    const other = withReplyTurn(
        () => true,
        () => tool.invoke(),
        healthy.signal,
    );
    cancelled.abort();
    expect(await old).toBe("cancelled");
    expect(healthy.signal.aborted).toBe(false);
    finish();
    expect(await other).toEqual({ status: "success", result: "healthy" });
});

it("removes the turn's abort listener when a tool completes normally", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const tool = fixture(async () => ({ status: "success" }));
    await withReplyTurn(
        () => true,
        () => tool.invoke(),
        controller.signal,
    );
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
});

it("releases cancellation while a successful tool receipt is still being persisted", async () => {
    const controller = new AbortController();
    let release!: () => void, ready!: () => void;
    const entered = new Promise<void>((resolve) => {
        ready = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
        release = resolve;
    });
    const tool = fixture(
        async () => ({ status: "success" }),
        0,
        async () => {
            ready();
            await blocked;
            return true;
        },
    );
    const invocation = withReplyTurn(
        () => true,
        () => tool.invoke({ platform: "onebot", channelId: "g", bot: {} }),
        controller.signal,
    );
    const outcome = invocation.then(
        () => "completed",
        () => "cancelled",
    );
    await entered;
    controller.abort();
    const result = await Promise.race([outcome, new Promise((resolve) => setTimeout(() => resolve("blocked"), 20))]);
    release();
    await outcome;
    expect(result).toBe("cancelled");
    expect(tool.errors).toEqual([]);
});
