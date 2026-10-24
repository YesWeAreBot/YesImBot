import { afterEach, expect, it, vi } from "vitest";

import { BackgroundTaskRegistry, type BackgroundTaskSettlement } from "../src/extension/background-tasks";

function deferred<T = unknown>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
const registries: BackgroundTaskRegistry[] = [];
function fixture(
    options: Partial<ConstructorParameters<typeof BackgroundTaskRegistry>[0]> = {},
    callback?: (event: BackgroundTaskSettlement) => void | Promise<void>,
) {
    const events: BackgroundTaskSettlement[] = [];
    const registry = new BackgroundTaskRegistry(
        { maxConcurrent: 4, maxRetained: 8, timeoutMs: 120000, settlement: "request", ...options },
        callback ??
            ((event) => {
                events.push(event);
            }),
    );
    registries.push(registry);
    return { registry, events };
}
async function settle() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}
afterEach(() => {
    for (const registry of registries.splice(0)) registry.dispose();
    vi.useRealTimers();
});

it("isolates owners and returns detached snapshots with bounded progress", async () => {
    const { registry } = fixture();
    const job = deferred();
    let report!: (progress: string) => void;
    const task = registry.start("a", "request", "read", async (_signal, progress) => {
        report = progress;
        return job.promise;
    });
    await settle();
    report("x".repeat(400));
    expect(registry.query("a", task.id).progress).toHaveLength(300);
    expect(() => registry.query("b", task.id)).toThrow(/Background/);
    expect(() => registry.cancel("b", task.id)).toThrow(/Background/);
    expect(registry.list("b")).toEqual([]);
    task.state = "failed";
    expect(registry.query("a", task.id).state).toBe("running");
    const result = { nested: { value: 1 } };
    job.resolve(result);
    await settle();
    result.nested.value = 2;
    const queried = registry.query("a", task.id);
    expect(queried.result).toEqual({ nested: { value: 1 } });
    (queried.result as typeof result).nested.value = 3;
    expect(registry.query("a", task.id).result).toEqual({ nested: { value: 1 } });
    expect(registry.list("a")[0]).not.toHaveProperty("result");
});

it("keeps noncooperative cancellation active until execution settles and discards late success", async () => {
    const { registry, events } = fixture({ maxConcurrent: 1, settlement: "task" });
    const job = deferred();
    let signal!: AbortSignal;
    const task = registry.start("a", "r", "read", async (current) => {
        signal = current;
        return job.promise;
    });
    await settle();
    expect(registry.cancel("a", task.id).state).toBe("cancelling");
    expect(signal.aborted).toBe(true);
    expect(() => registry.start("b", "r", "read", async () => 1)).toThrow(/Background/);
    expect(events).toEqual([]);
    registry.cancel("a", task.id);
    job.resolve("late secret");
    await settle();
    expect(registry.query("a", task.id).state).toBe("cancelled");
    expect(registry.query("a", task.id)).not.toHaveProperty("result");
    expect(events.map((event) => event.outcome)).toEqual(["cancelled"]);
    registry.cancel("a", task.id);
    expect(events).toHaveLength(1);
    expect(registry.start("b", "next", "read", async () => 1).state).toBe("running");
});

it("classifies a timeout as failure only after the underlying execution settles", async () => {
    vi.useFakeTimers();
    const { registry, events } = fixture({ timeoutMs: 25, settlement: "task" });
    const job = deferred();
    const task = registry.start("a", "r", "read", async () => job.promise);
    await settle();
    await vi.advanceTimersByTimeAsync(25);
    expect(registry.query("a", task.id).state).toBe("cancelling");
    expect(events).toEqual([]);
    job.reject(new Error("abort"));
    await settle();
    expect(registry.query("a", task.id).state).toBe("failed");
    expect(registry.query("a", task.id).error).toMatch(/timeout/i);
    expect(events[0].outcome).toBe("failed");
});

it("waits for sealing and fast siblings and emits one mixed request settlement", async () => {
    const { registry, events } = fixture();
    const first = registry.start("a", "r", "read", async () => 1);
    await settle();
    expect(events).toEqual([]);
    const second = registry.start("a", "r", "read", async () => {
        throw new Error("failed");
    });
    const thirdJob = deferred();
    const third = registry.start("a", "r", "read", async () => thirdJob.promise);
    registry.cancel("a", third.id);
    registry.sealRequest("a", "r");
    await settle();
    expect(events).toEqual([]);
    thirdJob.resolve(1);
    await settle();
    expect(events).toEqual([{ owner: "a", requestId: "r", taskIds: [first.id, second.id, third.id], outcome: "failed" }]);
    registry.sealRequest("a", "r");
    expect(events).toHaveLength(1);
    expect(() => registry.start("a", "r", "read", async () => 1)).toThrow(/Background/);
});

it("uses cancellation ahead of success and keeps identical request ids isolated by owner", async () => {
    const { registry, events } = fixture();
    const job = deferred();
    const task = registry.start("a", "r", "read", async () => job.promise);
    registry.start("a", "r", "read", async () => 1);
    registry.start("b", "r", "read", async () => 2);
    registry.sealRequest("a", "r");
    registry.sealRequest("b", "r");
    registry.cancel("a", task.id);
    job.resolve(0);
    await settle();
    expect(events.find((event) => event.owner === "a")?.outcome).toBe("cancelled");
    expect(events.find((event) => event.owner === "b")?.outcome).toBe("succeeded");
});

it("hides invalidated history and suppresses its settlement while retaining occupied execution slots", async () => {
    const { registry, events } = fixture({ maxConcurrent: 1 });
    const job = deferred();
    let valid = true;
    let signal!: AbortSignal;
    const task = registry.start(
        "a",
        "r",
        "read",
        async (current) => {
            signal = current;
            return job.promise;
        },
        () => valid,
    );
    await settle();
    registry.sealRequest("a", "r");
    valid = false;
    expect(registry.list("a")).toEqual([]);
    expect(() => registry.query("a", task.id)).toThrow(/Background/);
    expect(signal.aborted).toBe(true);
    expect(() => registry.start("b", "r", "read", async () => 1)).toThrow(/Background/);
    valid = true;
    expect(registry.list("a")).toEqual([]);
    job.resolve("stale");
    await settle();
    expect(events).toEqual([]);
    expect(registry.start("b", "r", "read", async () => 1)).toBeDefined();
});

it("invalidates completed results and running work without emitting completion", async () => {
    const { registry, events } = fixture();
    const finished = registry.start("a", "r", "read", async () => "secret");
    const job = deferred();
    const running = registry.start("a", "r", "read", async () => job.promise);
    await settle();
    registry.invalidate("a");
    registry.sealRequest("a", "r");
    expect(() => registry.query("a", finished.id)).toThrow(/Background/);
    expect(() => registry.cancel("a", running.id)).toThrow(/Background/);
    job.resolve("stale");
    await settle();
    expect(events).toEqual([]);
});

it("bounds retained history, prunes oldest terminal tasks, and clips list errors", async () => {
    const { registry } = fixture({ maxRetained: 2, settlement: "task" });
    const first = registry.start("a", "1", "read", async () => {
        throw new Error("x".repeat(900));
    });
    await settle();
    expect(registry.list("a")[0].error).toHaveLength(500);
    expect(registry.query("a", first.id).error).toHaveLength(900);
    const second = registry.start("a", "2", "read", async () => 2);
    await settle();
    const third = registry.start("a", "3", "read", async () => 3);
    expect(() => registry.query("a", first.id)).toThrow(/Background/);
    expect(registry.list("a").map((task) => task.id)).toEqual([third.id, second.id]);
    expect(registry.list("a", 1)).toHaveLength(1);
});

it("rejects retention overflow with only active work", () => {
    const { registry } = fixture({ maxRetained: 1 });
    registry.start("a", "r", "read", () => new Promise(() => {}));
    expect(() => registry.start("b", "r", "read", async () => 1)).toThrow(/Background/);
});

it("retains exact request membership until sealing and prunes settled request groups", async () => {
    const { registry, events } = fixture({ maxRetained: 2 });
    const first = registry.start("a", "r", "read", async () => 1);
    const second = registry.start("a", "r", "read", async () => 2);
    await settle();
    expect(() => registry.start("a", "other", "read", async () => 3)).toThrow(/Background/);
    registry.sealRequest("a", "r");
    expect(events[0].taskIds).toEqual([first.id, second.id]);
    registry.start("a", "next", "read", async () => 3);
    expect(registry.list("a")).toHaveLength(2);
});

it("keeps a pruned task-mode request registered when accepting a sibling", async () => {
    const { registry, events } = fixture({ maxRetained: 1, settlement: "task" });
    registry.start("a", "r", "read", async () => 1);
    await settle();
    registry.start("a", "r", "read", async () => 2);
    registry.sealRequest("a", "r");
    await settle();
    expect(events).toHaveLength(2);
    expect(() => registry.start("a", "r", "read", async () => 3)).toThrow(/Background/);
});

it("does not execute a task invalidated before its asynchronous invocation", async () => {
    const { registry, events } = fixture({ settlement: "task" });
    let calls = 0;
    const task = registry.start("a", "r", "read", async () => {
        calls++;
        return 1;
    });
    registry.invalidate("a");
    await settle();
    expect(calls).toBe(0);
    expect(registry.isCurrent("a", task.id)).toBe(false);
    expect(events).toEqual([]);
});

it.each(["sync", "async"])("consumes %s settlement callback failures", async (kind) => {
    const { registry } = fixture({ settlement: "task" }, () => {
        if (kind === "sync") throw new Error("callback");
        return Promise.reject(new Error("callback"));
    });
    const task = registry.start("a", "r", "read", async () => 1);
    await settle();
    expect(registry.query("a", task.id).state).toBe("succeeded");
});

it("disposal aborts active work and prevents subsequent starts, reports and settlements", async () => {
    const { registry, events } = fixture({ settlement: "task" });
    const job = deferred();
    let signal!: AbortSignal;
    let report!: (text: string) => void;
    registry.start("a", "r", "read", async (current, progress) => {
        signal = current;
        report = progress;
        return job.promise;
    });
    await settle();
    registry.dispose();
    expect(signal.aborted).toBe(true);
    report("late");
    job.resolve(1);
    await settle();
    expect(events).toEqual([]);
    expect(registry.list("a")).toEqual([]);
    expect(() => registry.start("a", "next", "read", async () => 1)).toThrow(/Background/);
});
