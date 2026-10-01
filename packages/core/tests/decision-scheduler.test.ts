import { expect, it } from "bun:test";
import { StimulusScheduler } from "../src/agent/scheduler";
import { Services } from "../src/shared/constants";

function setup(strategy = "skip") {
    const events: string[] = [];
    const calls: string[] = [];
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
        release = resolve;
    });
    const start = new Promise<void>((resolve) => {
        started = resolve;
    });
    const ctx: any = {
        [Services.Logger]: { getLogger: () => ({ debug() {}, warn() {} }) },
        debounce(fn: any, ms: number) {
            let timer: any;
            const task: any = (s: any) => {
                clearTimeout(timer);
                timer = setTimeout(() => fn(s), ms);
            };
            task.dispose = () => clearTimeout(timer);
            return task;
        },
    };
    const scheduler = new StimulusScheduler(
        ctx,
        { debounceMs: 2, newMessageStrategy: strategy, deferredProcessingTime: 5 } as any,
        async (s: any) => {
            calls.push(s.id);
            started();
            await waiting;
        },
        (s: any, stage: string, reason?: string) => events.push(`${s.id}:${stage}:${reason || ""}`)
    );
    return { scheduler, events, calls, release, start };
}
const message = (id: string) => ({ id, type: "user_message", channelCid: "bot-chat" }) as any;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

it("records the message replaced by debounce, then the one actually executed", async () => {
    const t = setup();
    t.scheduler.schedule(message("old"));
    t.scheduler.schedule(message("new"));
    await t.start;
    t.release();
    await settle();
    expect(t.events).toContain("old:cancelled:debounce_replaced");
    expect(t.events).toContain("new:running:");
    expect(t.calls).toEqual(["new"]);
    t.scheduler.dispose();
});

it("records a busy skip and cancels queued work without executing it", async () => {
    for (const strategy of ["skip", "immediate", "deferred"]) {
        const t = setup(strategy);
        t.scheduler.schedule(message("active"));
        await t.start;
        t.scheduler.schedule(message("next"));
        expect(t.events).toContain(`next:${strategy === "skip" ? "skipped" : "queued"}:busy`);
        t.scheduler.cancel("bot-chat");
        t.release();
        await settle();
        if (strategy !== "skip") expect(t.events).toContain("next:cancelled:reply_suppressed");
        expect(t.calls).toEqual(["active"]);
        t.scheduler.dispose();
    }
});
