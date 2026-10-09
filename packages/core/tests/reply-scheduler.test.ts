import { expect, it } from "bun:test";

import { StimulusScheduler } from "../src/agent/scheduler";
import { Services } from "../src/shared/constants";
function fixture(strategy = "skip") {
    const ctx = {
        [Services.Logger]: { getLogger: () => ({ debug() {}, warn() {} }) },
        debounce(fn: any, ms: number) {
            let timer: ReturnType<typeof setTimeout>;
            const task = (value: any) => {
                clearTimeout(timer);
                timer = setTimeout(() => void fn(value), ms);
            };
            task.dispose = () => clearTimeout(timer);
            return task;
        },
    };
    let start!: () => void;
    const started = new Promise<void>((r) => {
        start = r;
    });
    let finish!: () => void;
    const pending = new Promise<void>((r) => {
        finish = r;
    });
    const calls: string[] = [];
    const scheduler = new StimulusScheduler(ctx as any, { debounceMs: 2, newMessageStrategy: strategy, deferredProcessingTime: 5 } as any, async (s) => {
        calls.push(s.channelCid);
        start();
        await pending;
    });
    return { scheduler, calls, started, finish };
}
const stimulus = (channelCid: string) => ({ channelCid, type: "user_message" }) as any;
const settle = () => new Promise((r) => setTimeout(r, 20));
it("cancels pending debounce only for the selected bot conversation", async () => {
    const { scheduler, calls, finish } = fixture();
    scheduler.schedule(stimulus("bot1"));
    scheduler.schedule(stimulus("bot2"));
    scheduler.cancel("bot1");
    finish();
    await settle();
    expect(calls).toEqual(["bot2"]);
    scheduler.dispose();
});
for (const strategy of ["immediate", "deferred"])
    it(`cancels ${strategy} follow-up without replay after the active reply ends`, async () => {
        const { scheduler, calls, started, finish } = fixture(strategy);
        scheduler.schedule(stimulus("bot1"));
        await started;
        scheduler.schedule(stimulus("bot1"));
        scheduler.cancel("bot1");
        finish();
        await settle();
        expect(calls).toEqual(["bot1"]);
        scheduler.dispose();
    });
