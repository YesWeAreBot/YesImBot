import { expect, it } from "bun:test";

import { StimulusScheduler } from "../src/agent/scheduler";
import { Services } from "../src/shared/constants";

function barrier() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => (resolve = done));
    return { promise, resolve };
}

function recoveryFixture(strategy: string) {
    const releaseA = barrier();
    const calls: string[] = [];
    const active = new Map<string, number>();
    const maxActive = new Map<string, number>();
    const waiting = new Map<string, ReturnType<typeof barrier>>();
    const debounceTasks: Array<{ fire(): Promise<void> | undefined; pending(): boolean }> = [];
    const ctx = {
        [Services.Logger]: { getLogger: () => ({ debug() {}, warn() {} }) },
        // Control the debounce boundary without waiting for wall-clock delays.
        debounce(fn: (value: any) => Promise<void>) {
            let pending: any;
            const task = (value: any) => (pending = value);
            task.dispose = () => (pending = undefined);
            debounceTasks.push({
                pending: () => pending !== undefined,
                fire() {
                    if (pending === undefined) return;
                    const value = pending;
                    pending = undefined;
                    return fn(value);
                },
            });
            return task;
        },
    };
    const scheduler = new StimulusScheduler(ctx as any, { debounceMs: 2, newMessageStrategy: strategy, deferredProcessingTime: 1 } as any, async (stimulus) => {
        const { channelCid, id } = stimulus as any;
        const count = (active.get(channelCid) || 0) + 1;
        active.set(channelCid, count);
        maxActive.set(channelCid, Math.max(maxActive.get(channelCid) || 0, count));
        calls.push(id);
        waiting.get(id)?.resolve();
        try {
            if (id === "A") await releaseA.promise;
        } finally {
            active.set(channelCid, count - 1);
        }
    });
    return {
        scheduler,
        calls,
        maxActive,
        releaseA: releaseA.resolve,
        fireDebounces: () => debounceTasks.flatMap((task) => task.fire() ?? []),
        hasPendingDebounce: () => debounceTasks.some((task) => task.pending()),
        waitForCall(id: string) {
            const started = barrier();
            waiting.set(id, started);
            return started.promise;
        },
    };
}

const message = (id: string, channelCid = "bot1") => ({ id, channelCid, type: "user_message" }) as any;

for (const strategy of ["immediate", "deferred"]) {
    it(`runs new ${strategy} messages after cancel while the old reply is still finishing`, async () => {
        const f = recoveryFixture(strategy);
        try {
            f.scheduler.schedule(message("A"));
            const [oldReply] = f.fireDebounces();
            expect(f.calls).toEqual(["A"]);
            f.scheduler.schedule(message("old backlog"));
            f.scheduler.cancel("bot1");
            // Resume invalidates the turn again before allowing new messages.
            f.scheduler.cancel("bot1");
            const newReplyStarted = f.waitForCall("B");
            f.scheduler.schedule(message("B"));
            expect(f.scheduler.isBusy("bot1")).toBe(true);
            expect(f.fireDebounces()).toEqual([]);
            expect(f.calls).toEqual(["A"]);

            f.releaseA();
            await oldReply;
            if (strategy === "immediate") {
                await Promise.all(f.fireDebounces());
            } else {
                expect(f.scheduler.isBusy("bot1")).toBe(true);
                await newReplyStarted;
            }
            expect(f.calls).toEqual(["A", "B"]);
            expect(f.maxActive.get("bot1")).toBe(1);
        } finally {
            f.releaseA();
            f.scheduler.dispose();
        }
    });

    it(`clears old ${strategy} backlog when no new message arrives after cancel`, async () => {
        const f = recoveryFixture(strategy);
        try {
            f.scheduler.schedule(message("A"));
            const [oldReply] = f.fireDebounces();
            f.scheduler.schedule(message("old backlog"));
            f.scheduler.cancel("bot1");
            f.releaseA();
            await oldReply;
            await Promise.all(f.fireDebounces());
            expect(f.calls).toEqual(["A"]);
            expect(f.scheduler.isBusy("bot1")).toBe(false);
            expect(f.hasPendingDebounce()).toBe(false);
        } finally {
            f.releaseA();
            f.scheduler.dispose();
        }
    });

    it(`does not restart ${strategy} follow-ups when an old reply finishes after dispose`, async () => {
        const f = recoveryFixture(strategy);
        f.scheduler.schedule(message("A"));
        const [oldReply] = f.fireDebounces();
        f.scheduler.cancel("bot1");
        f.scheduler.schedule(message("B"));
        f.scheduler.dispose();
        f.releaseA();
        await oldReply;
        f.scheduler.schedule(message("after dispose"));
        await Promise.all(f.fireDebounces());
        expect(f.calls).toEqual(["A"]);
        expect(f.scheduler.isBusy("bot1")).toBe(false);
        expect(f.hasPendingDebounce()).toBe(false);
    });
}

it("recovers one channel without delaying or cancelling another channel", async () => {
    const f = recoveryFixture("immediate");
    try {
        f.scheduler.schedule(message("A"));
        const [oldReply] = f.fireDebounces();
        f.scheduler.schedule(message("other", "bot2"));
        f.scheduler.cancel("bot1");
        f.scheduler.schedule(message("B"));
        await Promise.all(f.fireDebounces());
        expect(f.calls).toEqual(["A", "other"]);
        expect(f.scheduler.isBusy("bot1")).toBe(true);
        expect(f.scheduler.isBusy("bot2")).toBe(false);
        f.releaseA();
        await oldReply;
        await Promise.all(f.fireDebounces());
        expect(f.calls).toEqual(["A", "other", "B"]);
        expect(f.maxActive.get("bot1")).toBe(1);
    } finally {
        f.releaseA();
        f.scheduler.dispose();
    }
});

it("continues skipping busy messages after cancel with the skip strategy", async () => {
    const f = recoveryFixture("skip");
    try {
        f.scheduler.schedule(message("A"));
        const [oldReply] = f.fireDebounces();
        f.scheduler.cancel("bot1");
        f.scheduler.schedule(message("B"));
        f.releaseA();
        await oldReply;
        await Promise.all(f.fireDebounces());
        expect(f.calls).toEqual(["A"]);
        f.scheduler.schedule(message("C"));
        await Promise.all(f.fireDebounces());
        expect(f.calls).toEqual(["A", "C"]);
    } finally {
        f.releaseA();
        f.scheduler.dispose();
    }
});
