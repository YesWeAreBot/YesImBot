import { expect, it } from "vitest";

import { PersonStore, registerModels } from "../src/store";
import { SummaryQueue, registerSummaryQueueModels } from "../src/summary-queue";
import { SummaryWorker } from "../src/worker";
import { fixture } from "./helpers";

it("treats schema-default empty account arrays as absence for list and all selections", async () => {
    const { catalogRequest } = await import("../src/profile-tools");
    expect(catalogRequest({ action: "list", account_ids: [] })).toMatchObject({ action: "list", account_ids: undefined });
    expect(catalogRequest({ action: "read_many", all: true, account_ids: [] })).toMatchObject({ all: true, account_ids: undefined });
});
it("purges only persistently owned scopes including audit baselines, across store reconstruction", async (t) => {
    const ctx = await fixture(t, registerModels);
    const own = new PersonStore(ctx.database, "review", { domain: () => "own" } as any),
        foreign = new PersonStore(ctx.database, "review", { domain: () => "foreign" } as any);
    await own.recognize("own-scene", "u", "Own");
    await own.capture("own-scene", { id: "old", userId: "u", name: "Own", text: "old", timestamp: Date.now() });
    await foreign.recognize("foreign-scene", "v", "Foreign");
    const restarted = new PersonStore(ctx.database, "review", { domain: () => "own" } as any);
    await (restarted as any).purgeOwned();
    expect((await restarted.read("own-scene")).people).toEqual({});
    expect(await ctx.database.get("person_memory.audit", { scope: "own-scene" })).toEqual([]);
    expect(await ctx.database.get("person_memory.sources", { scope: "own-scene" })).toEqual([]);
    expect(Object.keys((await foreign.read("foreign-scene")).people)).toHaveLength(1);
});
it("reset aborts in-flight inference, drops queued durable payloads and accepts only fresh work after release", async (t) => {
    const ctx = await fixture(t, (c) => {
        registerModels(c);
        registerSummaryQueueModels(c);
    });
    const store = new PersonStore(ctx.database, "review");
    for (const scope of ["a", "b"]) {
        await store.recognize(scope, "u", "User");
        await store.capture(scope, { id: "m", userId: "u", name: "User", text: "source", timestamp: Date.now() });
    }
    let release!: (s: string) => void, entered!: () => void, signal!: AbortSignal;
    const started = new Promise<void>((r) => {
        entered = r;
    });
    let calls = 0;
    const queue = new SummaryQueue(ctx.database, "own"),
        other = new SummaryQueue(ctx.database, "foreign");
    await other.enqueue("foreign", "u");
    const worker = new SummaryWorker(
        store,
        async (_m, s) => {
            calls++;
            if (calls > 1) return JSON.stringify({ profile: "fresh", messageIds: ["new"] });
            signal = s;
            entered();
            return new Promise<string>((r) => {
                release = r;
            });
        },
        { threshold: 2, cooldownMs: 1, timeoutMs: 10000, maxQueue: 4, durableQueue: queue },
        () => {},
    );
    t.onTestFinished(() => worker.stop());
    const first = worker.summarize("a", "u");
    const rejected = first.catch((error) => error);
    await started;
    const second = worker.summarize("b", "u");
    const queued = second.catch((error) => error);
    await (worker as any).reset();
    expect(String(await rejected)).toMatch(/取消/);
    expect(String(await queued)).toMatch(/取消/);
    expect(signal.aborted).toBe(true);
    expect(await queue.list()).toEqual([]);
    expect(await other.list()).toHaveLength(1);
    release(JSON.stringify({ profile: "late", messageIds: ["m"] }));
    await worker.idle();
    expect(Object.keys((await store.read("a")).proposals)).toHaveLength(0);
    expect(calls).toBe(1);
    (worker as any).resume();
    const fresh = new SummaryWorker(
        store,
        async () => JSON.stringify({ profile: "fresh", messageIds: ["m"] }),
        { threshold: 2, cooldownMs: 1, timeoutMs: 1000, maxQueue: 4, durableQueue: queue },
        () => {},
    );
    t.onTestFinished(() => fresh.stop());
    await fresh.init();
    expect(await queue.list()).toEqual([]);
    await store.capture("a", { id: "new", userId: "u", name: "User", text: "new message", timestamp: Date.now() });
    await worker.summarize("a", "u");
    expect(Object.values((await store.read("a")).proposals)[0].profile).toBe("fresh");
});

it("retains shared scopes when another owner has not joined the reset fence", async (t) => {
    const ctx = await fixture(t, registerModels);
    const a = new PersonStore(ctx.database, "review", { domain: () => "a" }),
        b = new PersonStore(ctx.database, "review", { domain: () => "b" });
    await a.recognize("shared", "u", "Shared");
    await b.read("shared");
    expect(await a.purgeOwned()).toEqual([]);
    expect(Object.keys((await b.read("shared")).people)).toHaveLength(1);
    expect(await ctx.database.get("person_memory.owners", { scope: "shared" })).toHaveLength(2);
});
it("regenerates malformed model candidates with bounded feedback instead of caching and replaying them", async (t) => {
    const ctx = await fixture(t, (c) => {
        registerModels(c);
        registerSummaryQueueModels(c);
    });
    const store = new PersonStore(ctx.database, "review");
    await store.recognize("s", "u", "U");
    await store.capture("s", { id: "m", userId: "u", name: "U", text: "source", timestamp: Date.now() });
    const queue = new SummaryQueue(ctx.database, "validation");
    let calls = 0;
    const inputs: any[] = [];
    const worker = new SummaryWorker(
        store,
        async (messages) => {
            inputs.push(messages);
            return JSON.stringify({ profile: ++calls === 1 ? { version: 9 } : "valid", messageIds: ["m"] });
        },
        { threshold: 2, cooldownMs: 1, timeoutMs: 1000, maxQueue: 2, retryDelayMs: 1, durableQueue: queue },
        () => {},
    );
    t.onTestFinished(() => worker.stop());
    await expect(worker.summarize("s", "u")).rejects.toThrow(/画像/);
    await expect.poll(async () => (await queue.list())[0]?.status).toBe("accepted");
    expect(calls).toBe(2);
    expect(inputs[1].at(-1).content).toContain("结构验证");
    expect(inputs[1][0]).toEqual(inputs[0][0]);
    expect(Object.values((await store.read("s")).proposals)[0].profile).toBe("valid");
});
for (const shared of [false, true])
    it(`${shared ? "shared" : "scene"} actual plugin reset fences delayed capture and purges only its owned data`, async (t) => {
        const { apply } = await import("../src/index");
        const { prepareHistoryReset } = await import("../../core/src/world/history-reset");
        const { sceneKey, mindScope } = await import("../src/store");
        const tools = new Map<string, any>();
        const app = await fixture(t, (ctx) => {
            const bot: any = {
                platform: "onebot",
                selfId: "bot",
                session: (e: any) => ({
                    ...e,
                    platform: "onebot",
                    selfId: "bot",
                    channelId: e.channel.id,
                    userId: e.user?.id ?? e.userId,
                    isDirect: e.channel.type === 1,
                    guildId: e.guild?.id,
                }),
            };
            Object.defineProperty(ctx, "bots", { value: [bot] });
            ctx.set("yesimbot", {
                ctx,
                world: { capabilities: { beforeUserStimulus: 1, memoryCorrectionFilter: 1 }, isChannelAllowed: () => true },
                tool: {
                    capabilities: { trustedToolSession: 1 },
                    registerTool: (tool) => {
                        tools.set(tool.name, tool);
                        return () => tools.delete(tool.name);
                    },
                },
                prompt: { inject: () => () => {} },
            });
            ctx.plugin({
                inject: ["database", "yesimbot"],
                apply: (plugin) =>
                    apply(plugin, {
                        enabled: true,
                        mode: "review",
                        sharedMemory: shared,
                        modelGroup: "",
                        summaryThreshold: 2,
                        cooldownSeconds: 30,
                        timeoutSeconds: 30,
                        maxQueue: 4,
                    }),
            });
        });
        const session: any = {
            bot: app.bots[0],
            platform: "onebot",
            selfId: "bot",
            channelId: "room",
            userId: "u",
            isDirect: false,
            author: { name: "User" },
            messageId: "old",
            content: "old",
            timestamp: Date.now(),
        };
        const scope = shared ? mindScope(session) : sceneKey(session);
        const get = app.database.get.bind(app.database);
        let release!: () => void,
            entered!: () => void,
            gateOnce = true;
        const reached = new Promise<void>((r) => {
                entered = r;
            }),
            gate = new Promise<void>((r) => {
                release = r;
            });
        app.database.get = async (table: any, ...args: any[]) => {
            const rows = await get(table, ...args);
            if (table === "person_memory.sources" && gateOnce) {
                gateOnce = false;
                entered();
                await gate;
            }
            return rows;
        };
        const capture = app.parallel("yesimbot/before-user-stimulus" as any, session);
        await reached;
        const preparation = prepareHistoryReset(app, { type: "all" });
        release();
        await preparation.ready;
        await capture;
        await preparation.finish();
        expect(await app.database.get("person_memory.audit", { scope })).toEqual([]);
        expect(await app.database.get("person_memory.sources", { scope })).toEqual([]);
        expect(await app.database.get("person_memory.state", { scope })).toEqual([]);
        const experiences = shared ? await app.database.get("person_memory.experiences", { scope }) : [];
        const scenes = shared ? await app.database.get("person_memory.scenes", { scope }) : [];
        expect(experiences).toEqual([]);
        expect(scenes).toEqual([]);
        await app.parallel("yesimbot/before-user-stimulus" as any, { ...session, messageId: "new", content: "fresh" });
        expect(await app.database.get("person_memory.sources", { scope })).toHaveLength(1);
        const listed = await tools.get("person_memory").execute({ session, action: "list", account_ids: [] });
        expect(listed).toMatchObject({ status: "success" });
    });
it("waits for a foreign snapshot enrollment before deciding whether a shared scope may be purged", async (t) => {
    const ctx = await fixture(t, registerModels);
    const a = new PersonStore(ctx.database, "review", { domain: () => "a" }),
        b = new PersonStore(ctx.database, "review", { domain: () => "b" });
    await a.recognize("s", "u", "User");
    await ctx.database.remove("person_memory.state", { scope: "s" });
    const upsert = ctx.database.upsert.bind(ctx.database);
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((r) => {
            entered = r;
        }),
        gate = new Promise<void>((r) => {
            release = r;
        });
    ctx.database.upsert = async (table: any, rows: any, ...args: any[]) => {
        if (table === "person_memory.owners" && rows[0].domain === "b") {
            entered();
            await gate;
        }
        return upsert(table, rows, ...args);
    };
    const reading = b.read("s");
    await reached;
    const purging = a.purgeOwned();
    release();
    expect(Object.keys((await reading).people)).toHaveLength(1);
    expect(await purging).toEqual([]);
    expect(await ctx.database.get("person_memory.state", { scope: "s" })).toHaveLength(1);
    expect(Object.keys((await a.read("s")).people)).toHaveLength(1);
});
it("clears legacy malformed durable output and regenerates once with the original input and corrective feedback", async (t) => {
    const ctx = await fixture(t, (c) => {
        registerModels(c);
        registerSummaryQueueModels(c);
    });
    const store = new PersonStore(ctx.database, "review");
    await store.recognize("s", "u", "U");
    await store.capture("s", { id: "m", userId: "u", name: "U", text: "source", timestamp: Date.now() });
    const queue = new SummaryQueue(ctx.database, "legacy-invalid"),
        config = { threshold: 2, cooldownMs: 1, timeoutMs: 1000, maxQueue: 2, retryDelayMs: 10000, durableQueue: queue };
    const first = new SummaryWorker(
        store,
        async () => JSON.stringify({ profile: { version: 9 }, messageIds: ["m"] }),
        config,
        () => {},
    );
    await expect(first.summarize("s", "u")).rejects.toThrow(/画像/);
    await first.stop();
    const [old] = await queue.list();
    await queue.patch(old, { output: { profile: { version: 9 }, messageIds: ["m"] }, nextAttempt: 0 });
    let calls = 0;
    const restored = new SummaryWorker(
        store,
        async (messages) => {
            calls++;
            expect(messages[0]).toEqual(old.input.messages[0]);
            expect(messages.at(-1).content).toContain("结构验证");
            return JSON.stringify({ profile: "repaired", messageIds: ["m"] });
        },
        config,
        () => {},
    );
    t.onTestFinished(() => restored.stop());
    await restored.summarize("s", "u");
    expect(calls).toBe(1);
    expect((await queue.list())[0].status).toBe("accepted");
});

it("keeps derived cleanup inside the scope fence so a new foreign owner cannot write into its deletion window", async (t) => {
    const { registerContinuityModels, ContinuityStore } = await import("../src/continuity");
    const ctx = await fixture(t, (c) => {
        registerModels(c);
        registerContinuityModels(c);
    });
    const a = new PersonStore(ctx.database, "review", { domain: () => "a" }),
        b = new PersonStore(ctx.database, "review", { domain: () => "b" });
    await a.recognize("s", "u", "Old");
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((r) => {
            entered = r;
        }),
        gate = new Promise<void>((r) => {
            release = r;
        });
    const remove = ctx.database.remove.bind(ctx.database);
    ctx.database.remove = async (table: any, ...args: any[]) => {
        if (table === "person_memory.experiences") {
            entered();
            await gate;
        }
        return remove(table, ...args);
    };
    const clearing = a.purgeOwned();
    await reached;
    await expect(b.read("s")).rejects.toThrow(/取消/);
    release();
    expect(await clearing).toEqual(["s"]);
    const identity = await b.recognize("s", "u", "New");
    const continuity = new ContinuityStore(ctx.database, b);
    await continuity.capture(
        "s",
        { platform: "onebot", selfId: "bot", channelId: "room", userId: "u" },
        { id: "new", userId: "u", name: "New", text: "fresh", timestamp: Date.now() },
        identity,
    );
    expect(await ctx.database.get("person_memory.experiences", { scope: "s" })).toHaveLength(1);
});
