import memory from "@koishijs/plugin-database-memory";
import { Context } from "koishi";
import { expect, it, type TestContext } from "vitest";

import { TaskStore, registerModels } from "../src/store";
import { TaskWorker } from "../src/worker";

async function fixture(t: TestContext) {
    const ctx = new Context();
    ctx.plugin(memory);
    registerModels(ctx);
    t.onTestFinished(() => ctx.stop());
    await ctx.start();
    await ctx.database.prepared();
    const store = new TaskStore(ctx.database, "owner");
    const task = await store.enqueue(
        {
            platform: "onebot",
            selfId: "bot",
            channelId: "group",
            requester: "u",
            guildId: "guild",
            isDirect: false,
            content: "喝水",
            idempotencyKey: "one",
            deadline: 1000,
        },
        0,
    );
    return { store, task };
}

it("dispatches each due reminder once with its explicit runtime owner", async (t) => {
    const { store, task } = await fixture(t);
    const deliveries: any[] = [];
    const worker = new TaskWorker(store, {
        prepare: async () => ({ session: {} as any, ownerId: "world-runtime-owner" }),
        dispatch: (...args) => {
            deliveries.push(args);
        },
    });
    await worker.start();
    await Promise.all([worker.tick(2000), worker.tick(2000)]);
    await worker.tick(2000);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0][2]).toBe("world-runtime-owner");
    expect((await store.get(task.id))?.status).toBe("completed");
});

it("fails a due job when the bot, channel, or permission cannot be revalidated", async (t) => {
    const { store, task } = await fixture(t);
    const deliveries: any[] = [];
    const worker = new TaskWorker(store, {
        prepare: async () => ({ error: "channel_not_allowed" }),
        dispatch: (...args) => {
            deliveries.push(args);
        },
    });
    await worker.start();
    await worker.tick(2000);
    expect(deliveries).toEqual([]);
    expect(await store.get(task.id)).toMatchObject({ status: "failed", error: "channel_not_allowed" });
});

for (const reason of ["cancel", "stop"] as const)
    it(`does not dispatch when ${reason} happens during permission validation`, async (t) => {
        const { store, task } = await fixture(t);
        let release!: () => void;
        let ready!: () => void;
        const waiting = new Promise<void>((resolve) => (release = resolve));
        const started = new Promise<void>((resolve) => (ready = resolve));
        const deliveries: any[] = [];
        const worker = new TaskWorker(store, {
            prepare: async () => {
                ready();
                await waiting;
                return { session: {} as any, ownerId: "owner" };
            },
            dispatch: (...args) => {
                deliveries.push(args);
            },
        });
        await worker.start();
        const running = worker.tick(2000);
        await started;
        if (reason === "cancel") await store.cancel(task.id);
        else worker.stop();
        release();
        await running;
        expect(deliveries).toEqual([]);
        expect((await store.get(task.id))?.status).toBe(reason === "cancel" ? "cancelled" : "running");
    });

it("marks an uncertain running job failed on restart instead of re-emitting it", async (t) => {
    const { store, task } = await fixture(t);
    await store.claim(task.id);
    const deliveries: any[] = [];
    const worker = new TaskWorker(store, {
        prepare: async () => ({ session: {} as any, ownerId: "owner" }),
        dispatch: (...args) => {
            deliveries.push(args);
        },
    });
    await worker.start();
    await worker.tick(2000);
    expect(deliveries).toEqual([]);
    expect(await store.get(task.id)).toMatchObject({ status: "failed", error: "interrupted_requires_retry" });
    await store.retry(task.id, 3000);
    await worker.tick(4000);
    expect(deliveries).toHaveLength(1);
});
