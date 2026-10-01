// Build the core package before running these startup lifecycle regressions.
import { expect, it, spyOn } from "bun:test";
import { Context } from "koishi";
import YesImBot from "../lib";
import { Config } from "../lib/config";

function controlledTimers() {
    let now = 0;
    let nextId = 0;
    const scheduled = new Map<number, { at: number; run: () => void }>();
    const timeout = spyOn(globalThis, "setTimeout").mockImplementation(((callback, delay = 0, ...args) => {
        const id = ++nextId;
        scheduled.set(id, { at: now + Number(delay), run: () => callback(...args) });
        return id;
    }) as any);
    const clear = spyOn(globalThis, "clearTimeout").mockImplementation(((id) => scheduled.delete(Number(id))) as any);
    const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    return {
        pending: () => scheduled.size,
        async advance(ms: number) {
            const target = now + ms;
            while (true) {
                const due = [...scheduled].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                scheduled.delete(due[0]);
                now = due[1].at;
                due[1].run();
                await flush();
            }
            now = target;
            await flush();
        },
        restore() { timeout.mockRestore(); clear.mockRestore(); },
    };
}

function startup(ready: boolean) {
    const ctx = new Context();
    const notices: unknown[] = [];
    ctx.notifier = { create: (notice: unknown) => notices.push(notice) } as any;
    // Child readiness is the controlled external input; YesImBot owns every startup timer.
    ctx.plugin = ((plugin) => ({ ready, ctx: { name: plugin.name } })) as typeof ctx.plugin;
    new YesImBot(ctx, Config({ version: "2.0.1", errorReporting: { enabled: false } }));
    return { ctx, notices };
}

it("releases its startup deadline once all child services are ready", async () => {
    const clock = controlledTimers();
    const { ctx, notices } = startup(true);
    try {
        await clock.advance(1000);
        expect(clock.pending()).toBe(0);
        await clock.advance(20000);
        expect(notices).toEqual([]);
    } finally {
        await ctx.stop();
        clock.restore();
    }
});

it("stops polling after startup times out and reports only once", async () => {
    const clock = controlledTimers();
    const { ctx, notices } = startup(false);
    try {
        await clock.advance(11000);
        expect(notices).toEqual(["初始化时发生错误"]);
        expect(clock.pending()).toBe(0);
        await clock.advance(20000);
        expect(notices).toHaveLength(1);
    } finally {
        await ctx.stop();
        clock.restore();
    }
});

it("releases startup timers on disposal without reporting an initialization failure", async () => {
    const clock = controlledTimers();
    const { ctx, notices } = startup(false);
    try {
        await clock.advance(1000);
        await ctx.stop();
        expect(clock.pending()).toBe(0);
        await clock.advance(20000);
        expect(notices).toEqual([]);
    } finally {
        await ctx.stop();
        clock.restore();
    }
});
