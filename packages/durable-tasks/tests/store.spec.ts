import memory from "@koishijs/plugin-database-memory";
import { Context } from "koishi";
import { expect, it, type TestContext } from "vitest";

import { TaskStore, registerModels } from "../src/store";

async function fixture(t: TestContext) {
    const ctx = new Context();
    ctx.plugin(memory);
    registerModels(ctx);
    t.onTestFinished(() => ctx.stop());
    await ctx.start();
    await ctx.database.prepared();
    return { ctx, store: new TaskStore(ctx.database, "owner") };
}
const target = { platform: "onebot", selfId: "bot", channelId: "group", requester: "user", isDirect: false, guildId: "guild" };
const reminder = { ...target, deadline: 1000, content: "提醒喝水", idempotencyKey: "drink-1" };

it("persists one reminder per owner, target, requester and idempotency key", async (t) => {
    const { ctx, store } = await fixture(t);
    const first = await store.enqueue(reminder, 0);
    const duplicate = await store.enqueue({ ...reminder, content: "different" }, 0);
    expect(duplicate).toEqual(first);
    expect((await store.list()).length).toBe(1);
    const other = new TaskStore(ctx.database, "other-owner");
    const row = await other.enqueue(reminder, 0);
    expect(row.id).not.toBe(first.id);
    expect(await store.get(row.id)).toBeUndefined();
});

it("claims queued jobs with a conditional state transition once", async (t) => {
    const { ctx, store } = await fixture(t);
    const row = await store.enqueue(reminder, 0);
    const competing = new TaskStore(ctx.database, "owner");
    const results = await Promise.all([store.claim(row.id), competing.claim(row.id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store.get(row.id))?.status).toBe("running");
});

it("recovers running jobs as failed without replaying them, and preserves queued jobs", async (t) => {
    const { ctx, store } = await fixture(t);
    const running = await store.enqueue(reminder, 0);
    const queued = await store.enqueue({ ...reminder, idempotencyKey: "second" }, 0);
    await store.claim(running.id);
    const restarted = new TaskStore(ctx.database, "owner");
    await restarted.recover();
    expect((await restarted.get(running.id))?.status).toBe("failed");
    expect((await restarted.get(running.id))?.error).toBe("interrupted_requires_retry");
    expect((await restarted.due(2000)).map((row) => row.id)).toEqual([queued.id]);
    expect(await restarted.retry(running.id, 3000)).toBe(true);
    expect((await restarted.get(running.id))?.status).toBe("queued");
});

it("cancellation wins over late completion and rejects another owner's mutation", async (t) => {
    const { ctx, store } = await fixture(t);
    const row = await store.enqueue(reminder, 0);
    await store.claim(row.id);
    expect(await new TaskStore(ctx.database, "other").cancel(row.id)).toBe(false);
    expect(await store.cancel(row.id)).toBe(true);
    expect(await store.complete(row.id)).toBe(false);
    expect((await store.get(row.id))?.status).toBe("cancelled");
});

it("rejects invalid deadlines and unbounded reminder data", async (t) => {
    const { store } = await fixture(t);
    await expect(store.enqueue({ ...reminder, deadline: NaN }, 0)).rejects.toThrow("deadline");
    await expect(store.enqueue({ ...reminder, deadline: -1 }, 0)).rejects.toThrow("deadline");
    await expect(store.enqueue({ ...reminder, content: "x".repeat(2001) }, 0)).rejects.toThrow("content");
    await expect(store.enqueue({ ...reminder, idempotencyKey: "" }, 0)).rejects.toThrow("idempotency");
});

it("isolates identical request keys by platform, bot, channel and requester", async (t) => {
    const { store } = await fixture(t);
    const original = await store.enqueue(reminder, 0);
    for (const field of ["platform", "selfId", "channelId", "requester"] as const) {
        const other = await store.enqueue({ ...reminder, [field]: "different" }, 0);
        expect(other.id).not.toBe(original.id);
        expect(await store.list(other)).toContainEqual(other);
    }
    expect(await store.list()).toHaveLength(5);
});

it("keeps chat type and known guild identity in reminder IDs and list queries", async (t) => {
    const { store } = await fixture(t);
    const variants = [
        { isDirect: false, guildId: "guild" },
        { isDirect: true, guildId: "" },
        { isDirect: false, guildId: "other-guild" },
        { isDirect: false, guildId: "" },
    ];
    const tasks = [];
    for (const scene of variants) tasks.push(await store.enqueue({ ...reminder, ...scene }, 0));
    expect(new Set(tasks.map((task) => task.id)).size).toBe(4);
    for (const task of tasks) expect(await store.list(task)).toEqual([task]);
});

it("returns the accepted row for an identical retry after its deadline", async (t) => {
    const { store } = await fixture(t);
    const accepted = await store.enqueue(reminder, 0);
    await expect(store.enqueue(reminder, 2000)).resolves.toEqual(accepted);
    await expect(store.enqueue({ ...reminder, idempotencyKey: "new-expired" }, 2000)).rejects.toThrow("deadline");
    await expect(store.enqueue({ ...reminder, content: "" }, 2000)).rejects.toThrow("content");
    await expect(store.enqueue({ ...reminder, deadline: NaN }, 2000)).rejects.toThrow("deadline");
    await expect(store.enqueue(reminder, 2000, () => false)).rejects.toThrow("reminder_request_invalidated");
    expect(await store.list()).toEqual([accepted]);
});

it("rejects an expired duplicate if its request is invalidated during lookup", async (t) => {
    const { ctx, store } = await fixture(t);
    const accepted = await store.enqueue(reminder, 0);
    let current = true;
    const get = ctx.database.get.bind(ctx.database);
    ctx.database.get = (async (...args: any[]) => {
        const rows = await (get as any)(...args);
        current = false;
        return rows;
    }) as any;
    await expect(store.enqueue(reminder, 2000, () => current)).rejects.toThrow("reminder_request_invalidated");
    expect(await store.get(accepted.id)).toEqual(accepted);
});
