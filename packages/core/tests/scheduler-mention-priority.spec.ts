import { afterEach, expect, it, vi } from "vitest";

import { StimulusScheduler } from "../src/agent/scheduler";
import { loggingStub } from "./helpers/yesimbot";

afterEach(() => vi.useRealTimers());

function setup(prioritizeMentions = true, strategy = "immediate") {
    vi.useFakeTimers();
    const calls: string[] = [];
    const events: string[] = [];
    let release!: () => void;
    const active = new Promise<void>((resolve) => {
        release = resolve;
    });
    const ctx = {
        debounce(fn: (value: any) => Promise<void>, ms: number) {
            let timer: ReturnType<typeof setTimeout>;
            const task = (value: any) => {
                clearTimeout(timer);
                timer = setTimeout(() => void fn(value), ms);
            };
            task.dispose = () => clearTimeout(timer);
            return task;
        },
    };
    const scheduler = new StimulusScheduler(
        ctx as any,
        { prioritizeMentions, debounceMs: 10, newMessageStrategy: strategy, deferredProcessingTime: 100 } as any,
        async (stimulus: any) => {
            calls.push(stimulus.id);
            if (stimulus.id === "active") await active;
        },
        loggingStub(),
        (stimulus: any, stage, reason) => events.push(`${stimulus.id}:${stage}:${reason ?? ""}`),
    );
    return { scheduler, calls, events, release };
}

function message(id: string, mention?: string, channelCid = "bot:group") {
    return {
        id,
        channelCid,
        type: "user_message",
        session: { selfId: "bot", bot: { selfId: "bot" }, stripped: {}, elements: mention ? [{ type: "at", attrs: { id: mention } }] : [] },
    } as any;
}

it("preserves an accepted explicit bot mention through ordinary debounce floods without postponing it", async () => {
    const f = setup();
    try {
        f.scheduler.schedule(message("mention", "bot"));
        for (let index = 0; index < 9; index++) {
            await vi.advanceTimersByTimeAsync(1);
            f.scheduler.schedule(message(`flood-${index}`));
        }
        await vi.advanceTimersByTimeAsync(1);
        expect(f.calls).toEqual(["mention"]);
        expect(f.events).toContain("flood-0:skipped:mention_priority");
        expect(f.events).not.toContain("mention:cancelled:debounce_replaced");
    } finally {
        f.release();
        f.scheduler.dispose();
    }
});

for (const strategy of ["immediate", "deferred"]) {
    it(`preserves a queued mention under ${strategy} without overlapping the active reply`, async () => {
        const f = setup(true, strategy);
        try {
            f.scheduler.schedule(message("active"));
            await vi.advanceTimersByTimeAsync(10);
            f.scheduler.schedule(message("mention", "bot"));
            f.scheduler.schedule(message("ordinary"));
            expect(f.calls).toEqual(["active"]);
            f.release();
            await vi.advanceTimersByTimeAsync(strategy === "deferred" ? 100 : 10);
            expect(f.calls).toEqual(["active", "mention"]);
        } finally {
            f.release();
            f.scheduler.dispose();
        }
    });
}

it("keeps the default replacement behavior when mention priority is disabled", async () => {
    const f = setup(false);
    try {
        f.scheduler.schedule(message("mention", "bot"));
        f.scheduler.schedule(message("ordinary"));
        await vi.advanceTimersByTimeAsync(10);
        expect(f.calls).toEqual(["ordinary"]);
    } finally {
        f.release();
        f.scheduler.dispose();
    }
});

it("does not promote mentions of other users or all members", async () => {
    for (const target of ["other", "all"]) {
        const f = setup();
        try {
            f.scheduler.schedule(message("other-mention", target));
            f.scheduler.schedule(message("ordinary"));
            await vi.advanceTimersByTimeAsync(10);
            expect(f.calls).toEqual(["ordinary"]);
        } finally {
            f.release();
            f.scheduler.dispose();
        }
    }
});

it("honors skip strategy, cancellation and per-bot conversation isolation", async () => {
    const f = setup(true, "skip");
    try {
        f.scheduler.schedule(message("active"));
        await vi.advanceTimersByTimeAsync(10);
        f.scheduler.schedule(message("busy-mention", "bot"));
        f.scheduler.schedule(message("cancelled-mention", "bot", "other-bot:group"));
        f.scheduler.cancel("other-bot:group");
        f.release();
        await vi.advanceTimersByTimeAsync(1000);
        expect(f.calls).toEqual(["active"]);
        expect(f.events).toContain("busy-mention:skipped:busy");
        expect(f.events).toContain("cancelled-mention:cancelled:reply_suppressed");
    } finally {
        f.release();
        f.scheduler.dispose();
    }
});
