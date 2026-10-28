import { afterEach, expect, it, vi } from "vitest";

import { StimulusScheduler } from "../src/agent/scheduler";
import { loggingStub } from "./helpers/yesimbot";

afterEach(() => vi.useRealTimers());

function setup() {
    vi.useFakeTimers();
    const calls: any[] = [];
    let release!: () => void;
    const active = new Promise<void>((resolve) => (release = resolve));
    let releaseCompletion!: () => void;
    const completion = new Promise<void>((resolve) => (releaseCompletion = resolve));
    const scheduler = new StimulusScheduler(
        {
            debounce(fn: any, ms: number) {
                let timer: ReturnType<typeof setTimeout>;
                const task = (value: any) => {
                    clearTimeout(timer);
                    timer = setTimeout(() => void fn(value), ms);
                };
                task.dispose = () => clearTimeout(timer);
                return task;
            },
        } as any,
        { debounceMs: 10, prioritizeMentions: true, newMessageStrategy: "deferred", deferredProcessingTime: 100 } as any,
        async (stimulus: any) => {
            calls.push(stimulus);
            if (stimulus.id === "active") await active;
            if (stimulus.id === "done") await completion;
        },
        loggingStub(),
    );
    return { scheduler, calls, release, releaseCompletion };
}

function stimulus(id: string, type = "user_message", channelCid = "bot:group") {
    return {
        id,
        type,
        channelCid,
        payload: { taskIds: [id] },
        session: { selfId: "bot", bot: { selfId: "bot" }, stripped: { atSelf: id === "mention" }, elements: [] },
    } as any;
}

it.each([false, true])("restarts the full quiet period after traffic during a completion (scheduled: %s)", async (scheduleMessage) => {
    const f = setup();
    try {
        f.scheduler.schedule(stimulus("active"));
        await vi.advanceTimersByTimeAsync(10);
        f.scheduler.schedule(stimulus("mention"));
        f.scheduler.schedule(stimulus("done", "background_task_completion"));
        f.release();
        // The original quiet period expires while the completion still owns the channel.
        await vi.advanceTimersByTimeAsync(100);
        expect(f.calls.map((s) => s.id)).toEqual(["active", "done"]);
        f.scheduler.noteUserMessage("bot:group");
        if (scheduleMessage) f.scheduler.schedule(stimulus("new-user"));
        await vi.advanceTimersByTimeAsync(40);
        f.releaseCompletion();
        await vi.advanceTimersByTimeAsync(59);
        expect(f.calls.map((s) => s.id)).toEqual(["active", "done"]);
        await vi.advanceTimersByTimeAsync(1);
        expect(f.calls.map((s) => s.id)).toEqual(["active", "done", "mention"]);
    } finally {
        f.release();
        f.releaseCompletion();
        f.scheduler.dispose();
    }
});
