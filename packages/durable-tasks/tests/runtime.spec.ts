import memory from "@koishijs/plugin-database-memory";
import pluginMock from "@koishijs/plugin-mock";
import { Context } from "koishi";
import { expect, it, vi, type TestContext } from "vitest";
vi.mock("koishi-plugin-yesimbot", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getInstanceScope: (ctx: Context, _warn: unknown, options?: unknown) => `${(ctx.root as any).scopePrefix ?? ""}${options ? "plugin-scope" : "core-scope"}`,
}));
import { stubYesImBot } from "../../core/tests/helpers/yesimbot";
import * as plugin from "../src/index";
import { TABLE, TaskStore, registerModels, taskOwner } from "../src/store";
const session = (channelId = "g", userId = "u", selfId = "bot") =>
    ({ platform: "onebot", selfId, channelId, userId, guildId: "guild", isDirect: false }) as any;
async function fixture(t: TestContext, enabled = true) {
    const ctx = new Context();
    ctx.plugin(memory);
    const mockFork = ctx.plugin((pluginMock as any).default ?? pluginMock);
    const tools = new Map<string, any>();
    const world = {
        stimulusOwnerId: "world",
        isChannelAllowed: () => true,
        isBotMuted: () => false,
        l2_manager: { getHistoryGeneration: () => 0 },
        recordSystemEvent: async () => true,
    };
    const tool = {
        capabilities: { trustedToolSession: 1 },
        registerTool: (tool: any) => {
            tools.set(tool.name, tool);
            return () => tools.delete(tool.name);
        },
    };
    ctx.set("yesimbot", stubYesImBot({ tool, world }));
    const fork = ctx.plugin(plugin, { enabled, pollIntervalSeconds: 60 });
    t.onTestFinished(async () => {
        fork.dispose();
        mockFork.dispose();
        await ctx.stop();
    });
    await ctx.start();
    await ctx.database.prepared();
    return { ctx, tools, session, world, fork };
}
it("defaults to disabled and registers no tools when disabled", async (t) => {
    expect(plugin.Config({}).enabled).toBe(false);
    expect((await fixture(t, false)).tools.size).toBe(0);
});
it("binds reminder targets to the injected session and rejects cross-channel/user cancellation", async (t) => {
    const f = await fixture(t);
    const schedule = f.tools.get("schedule_reminder");
    const cancel = f.tools.get("cancel_reminder");
    const result = await schedule.execute({
        session: f.session(),
        deadline: Date.now() + 3600000,
        content: "喝水",
        idempotency_key: "one",
        channelId: "evil",
        selfId: "evil",
    });
    expect(result.status).toBe("success");
    const id = result.result.id;
    expect((await f.ctx.database.get(TABLE, { id }))[0]).toMatchObject({ channelId: "g", selfId: "bot" });
    for (const s of [f.session("other"), f.session("g", "other"), f.session("g", "u", "other")]) {
        expect((await cancel.execute({ session: s, id })).status).toBe("error");
    }
    expect((await cancel.execute({ session: f.session(), id })).result.cancelled).toBe(true);
});
it("stops tool activity on disposal and checks current channel permissions", async (t) => {
    const f = await fixture(t);
    const tool = f.tools.get("schedule_reminder");
    const args = { session: f.session(), deadline: Date.now() + 3600000, content: "x", idempotency_key: "one" };
    f.world.isChannelAllowed = () => false;
    expect((await tool.execute(args)).status).toBe("error");
    f.fork.dispose();
    expect(f.tools.size).toBe(0);
    expect((await tool.execute(args)).status).toBe("error");
});

it("enforces administrator authority and current-session bounds for list/cancel/retry", async (t) => {
    const f = await fixture(t);
    const mock = (f.ctx as any).mock;
    await mock.initUser("admin", 3);
    await mock.initUser("member", 1);
    await mock.initChannel("g");
    await mock.initChannel("other");
    const admin = mock.client("admin", "g");
    const member = mock.client("member", "g");
    const other = mock.client("admin", "other");
    const session = { ...f.session(), platform: "mock", selfId: f.ctx.bots[0].selfId, guildId: "g" };
    const created = await f.tools.get("schedule_reminder").execute({ session, deadline: Date.now() + 3600000, content: "x", idempotency_key: "admin-check" });
    const id = created.result.id;
    expect((await member.receive(`reminder.cancel ${id}`)).join("")).not.toContain("已取消");
    expect((await other.receive(`reminder.cancel ${id}`)).join("")).toContain("不属于当前会话");
    expect((await admin.receive("reminder.list")).join("")).toContain(id);
    await f.ctx.database.set(TABLE, { id }, { status: "failed", error: "interrupted_requires_retry" });
    expect((await other.receive(`reminder.retry ${id}`)).join("")).toContain("不属于当前会话");
    expect((await admin.receive(`reminder.retry ${id}`)).join("")).toContain("已排队重试");
    expect((await admin.receive(`reminder.cancel ${id}`)).join("")).toContain("已取消");
});

it("runs a real due reminder through database, restored bot session, event write and targeted stimulus", async (t) => {
    const ctx = new Context();
    ctx.plugin(memory);
    const mockFork = ctx.plugin((pluginMock as any).default ?? pluginMock);
    const tools = new Map<string, any>();
    ctx.model.extend(
        "yesimbot.reply_rules" as any,
        { id: "string", platform: "string", selfId: "string", channelId: "string", blocked: "list", expiresAt: "double" },
        { primary: "id" },
    );
    const tool = {
        capabilities: { trustedToolSession: 1 },
        registerTool: (tool: any) => {
            tools.set(tool.name, tool);
            return () => tools.delete(tool.name);
        },
    };
    const recordSystemEvent = vi.fn<(...args: any[]) => Promise<boolean>>(async () => true);
    const world = {
        stimulusOwnerId: "world",
        isChannelAllowed: () => true,
        isBotMuted: () => false,
        l2_manager: { getHistoryGeneration: () => 0 },
        recordSystemEvent,
    };
    ctx.set("yesimbot", stubYesImBot({ tool, world }));
    const stimuli: any[] = [];
    ctx.on("agent/stimulus" as any, (...args: any[]) => {
        stimuli.push(args);
    });
    const fork = ctx.plugin(plugin, { enabled: true, pollIntervalSeconds: 1 });
    t.onTestFinished(async () => {
        fork.dispose();
        mockFork.dispose();
        await ctx.stop();
    });
    await ctx.start();
    const bot = ctx.bots[0];
    bot.getChannel = async () => ({ id: "g", type: 0 });
    const session = bot.session({ user: { id: "u" }, channel: { id: "g", type: 0 }, guild: { id: "guild" } });
    const result = await tools.get("schedule_reminder").execute({ session, deadline: Date.now() + 10, content: "提醒正文", idempotency_key: "delivery" });
    expect(result.status).toBe("success");
    await vi.waitFor(
        async () => {
            expect((await ctx.database.get(TABLE, { id: result.result.id }))[0].status).toBe("completed");
        },
        { timeout: 2500, interval: 50 },
    );
    expect(recordSystemEvent).toHaveBeenCalledTimes(1);
    expect(recordSystemEvent.mock.calls[0][0]).toMatchObject({ message: "提醒正文", eventScope: "channel", botKey: JSON.stringify(["mock", bot.selfId]) });
    expect(stimuli).toHaveLength(1);
    expect(stimuli[0]).toEqual([expect.objectContaining({ type: "scheduled_task", channelCid: "mock:g" }), "world"]);
});

it("does not let a session sharing a raw channel id cancel reminders from another guild or chat type", async (t) => {
    const f = await fixture(t);
    const created = await f.tools
        .get("schedule_reminder")
        .execute({ session: f.session(), deadline: Date.now() + 3600000, content: "x", idempotency_key: "guild-check" });
    const cancel = f.tools.get("cancel_reminder");
    for (const scene of [{ guildId: "other-guild" }, { guildId: "" }, { isDirect: true, guildId: "" }]) {
        const result = await cancel.execute({ session: { ...f.session(), ...scene }, id: created.result.id });
        expect(result.status).toBe("error");
    }
    expect((await f.ctx.database.get(TABLE, { id: created.result.id }))[0].status).toBe("queued");
});

for (const invalidation of ["dispose", "permission", "target"] as const)
    it(`does not create a queued reminder after ${invalidation} during dedup lookup`, async (t) => {
        const f = await fixture(t);
        const tool = f.tools.get("schedule_reminder");
        const get = f.ctx.database.get.bind(f.ctx.database);
        let release!: () => void, entered!: () => void;
        const waiting = new Promise<void>((r) => (release = r)),
            started = new Promise<void>((r) => (entered = r));
        let once = true;
        f.ctx.database.get = (async (table: any, query: any, ...rest: any[]) => {
            if (table === TABLE && query?.id && once) {
                once = false;
                entered();
                await waiting;
            }
            return get(table, query, ...(rest as any));
        }) as any;
        const session = f.session();
        const pending = tool.execute({ session, deadline: Date.now() + 3600000, content: "late", idempotency_key: "late" });
        await started;
        if (invalidation === "dispose") f.fork.dispose();
        if (invalidation === "permission") f.world.isChannelAllowed = () => false;
        if (invalidation === "target") session.guildId = "other-guild";
        release();
        expect((await pending).status).toBe("error");
        expect(await get(TABLE, {})).toHaveLength(0);
    });

it("reports accepted database facts if disposal happens after create was dispatched", async (t) => {
    const f = await fixture(t);
    const create = f.ctx.database.create.bind(f.ctx.database);
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((r) => (release = r)),
        started = new Promise<void>((r) => (entered = r));
    f.ctx.database.create = (async (table: any, row: any) => {
        if (table === TABLE) {
            entered();
            await waiting;
        }
        return create(table, row);
    }) as any;
    const pending = f.tools
        .get("schedule_reminder")
        .execute({ session: f.session(), deadline: Date.now() + 3600000, content: "late", idempotency_key: "late-create" });
    await started;
    f.fork.dispose();
    release();
    const result = await pending;
    expect(result.status).toBe("error");
    expect(result.accepted).toMatchObject({ status: "queued" });
    expect((await f.ctx.database.get(TABLE, {}))[0].id).toBe(result.accepted.id);
});

it("does not cancel a reminder if disposal happens during its target lookup", async (t) => {
    const f = await fixture(t);
    const created = await f.tools
        .get("schedule_reminder")
        .execute({ session: f.session(), deadline: Date.now() + 3600000, content: "x", idempotency_key: "cancel-dispose" });
    const get = f.ctx.database.get.bind(f.ctx.database);
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((r) => (release = r)),
        started = new Promise<void>((r) => (entered = r));
    f.ctx.database.get = (async (table: any, query: any, ...rest: any[]) => {
        if (table === TABLE && query?.id) {
            entered();
            await waiting;
        }
        return get(table, query, ...(rest as any));
    }) as any;
    const pending = f.tools.get("cancel_reminder").execute({ session: f.session(), id: created.result.id });
    await started;
    f.fork.dispose();
    release();
    expect((await pending).status).toBe("error");
    expect((await get(TABLE, { id: created.result.id }))[0].status).toBe("queued");
});

for (const action of ["cancel", "retry"] as const)
    it(`does not administratively ${action} after disposal during target lookup`, async (t) => {
        const f = await fixture(t);
        const mock = (f.ctx as any).mock;
        await mock.initUser("admin", 3);
        await mock.initChannel("g");
        const session = { ...f.session(), platform: "mock", selfId: f.ctx.bots[0].selfId, guildId: "g" };
        const created = await f.tools
            .get("schedule_reminder")
            .execute({ session, deadline: Date.now() + 3600000, content: "x", idempotency_key: `admin-dispose-${action}` });
        if (action === "retry") await f.ctx.database.set(TABLE, { id: created.result.id }, { status: "failed" });
        const get = f.ctx.database.get.bind(f.ctx.database);
        let release!: () => void, entered!: () => void;
        const waiting = new Promise<void>((r) => (release = r)),
            started = new Promise<void>((r) => (entered = r));
        f.ctx.database.get = (async (table: any, query: any, ...rest: any[]) => {
            if (table === TABLE && query?.id) {
                entered();
                await waiting;
            }
            return get(table, query, ...(rest as any));
        }) as any;
        const pending = mock.client("admin", "g").receive(`reminder.${action} ${created.result.id}`);
        await started;
        f.fork.dispose();
        release();
        expect((await pending).join("")).not.toContain(action === "cancel" ? "已取消" : "已排队重试");
        expect((await get(TABLE, { id: created.result.id }))[0].status).toBe(action === "cancel" ? "queued" : "failed");
    });

it("reports an already dispatched cancellation accurately after disposal", async (t) => {
    const f = await fixture(t);
    const created = await f.tools
        .get("schedule_reminder")
        .execute({ session: f.session(), deadline: Date.now() + 3600000, content: "x", idempotency_key: "cancel-accepted" });
    const set = f.ctx.database.set.bind(f.ctx.database);
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((r) => (release = r)),
        started = new Promise<void>((r) => (entered = r));
    f.ctx.database.set = (async (table: any, query: any, update: any) => {
        if (table === TABLE && update.status === "cancelled") {
            entered();
            await waiting;
        }
        return set(table, query, update);
    }) as any;
    const pending = f.tools.get("cancel_reminder").execute({ session: f.session(), id: created.result.id });
    await started;
    f.fork.dispose();
    release();
    const result = await pending;
    expect(result.status).toBe("error");
    expect(result.applied).toEqual({ id: created.result.id, cancelled: true });
    expect((await f.ctx.database.get(TABLE, { id: created.result.id }))[0].status).toBe("cancelled");
});

async function pendingCoreFixture(t: TestContext, scopePrefix = "", holdDatabase = false) {
    const ctx = new Context();
    ctx.plugin(memory);
    registerModels(ctx);
    await ctx.start();
    await ctx.database.prepared();
    let resolve!: () => void, reject!: (error: Error) => void;
    const ready = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    // Rejections are also observed by the plugin's lifecycle initialization.
    void ready.catch(() => {});
    const tools = new Map<string, any>();
    const world = {
        stimulusOwnerId: "world",
        isChannelAllowed: () => true,
        isBotMuted: () => false,
        l2_manager: { getHistoryGeneration: () => 0 },
        recordSystemEvent: async () => true,
    };
    ctx.set("yesimbot", {
        ...stubYesImBot({
            world,
            tool: {
                capabilities: { trustedToolSession: 1 },
                registerTool: (tool: any) => {
                    tools.set(tool.name, tool);
                    return () => tools.delete(tool.name);
                },
            },
        }),
        ready,
    } as any);
    const store = new TaskStore(ctx.database, taskOwner(`${scopePrefix}core-scope`, `${scopePrefix}plugin-scope`));
    const input = {
        platform: "onebot",
        selfId: "bot",
        channelId: "g",
        requester: "u",
        guildId: "guild",
        isDirect: false,
        deadline: 1000,
        content: "queued before startup",
        idempotencyKey: "queued",
    };
    const queued = await store.enqueue(input, 0);
    const running = await store.enqueue({ ...input, idempotencyKey: "running" }, 0);
    await store.claim(running.id);
    let resolveDatabase!: () => void;
    const databaseReady = new Promise<void>((done) => {
        resolveDatabase = done;
    });
    if (holdDatabase) {
        const prepared = ctx.database.prepared.bind(ctx.database);
        ctx.database.prepared = async () => {
            await prepared();
            await databaseReady;
        };
    }
    const fork = ctx.plugin(plugin, { enabled: true, pollIntervalSeconds: 60 });
    t.onTestFinished(async () => {
        resolveDatabase();
        resolve();
        fork.dispose();
        await ctx.stop();
    });
    await vi.waitFor(() => expect(tools.size).toBe(2));
    await new Promise<void>((done) => setImmediate(done));
    return { ctx, store, queued, running, fork, tools, resolve, reject, resolveDatabase };
}

it("leaves queued and running reminders untouched until core readiness", async (t) => {
    const f = await pendingCoreFixture(t);
    expect((await f.store.get(f.queued.id))?.status).toBe("queued");
    expect((await f.store.get(f.running.id))?.status).toBe("running");
    expect(f.tools.get("schedule_reminder").isSupported(session())).toBe(false);
    f.resolve();
    await f.ctx.lifecycle.flush();
    await vi.waitFor(async () => expect((await f.store.get(f.running.id))?.status).toBe("failed"));
});

for (const interruption of ["dispose", "reject"] as const)
    it(`does not consume reminders after ${interruption} while waiting for core readiness`, async (t) => {
        const f = await pendingCoreFixture(t);
        if (interruption === "dispose") {
            f.fork.dispose();
            f.resolve();
        } else f.reject(new Error("core initialization failed"));
        await f.ctx.lifecycle.flush();
        expect((await f.store.get(f.queued.id))?.status).toBe("queued");
        expect((await f.store.get(f.running.id))?.status).toBe("running");
    });

it("derives reminder ownership after core readiness supplies the stable scope", async (t) => {
    const f = await pendingCoreFixture(t, "stable-");
    (f.ctx.root as any).scopePrefix = "stable-";
    f.resolve();
    await f.ctx.lifecycle.flush();
    await vi.waitFor(async () => expect((await f.store.get(f.running.id))?.status).toBe("failed"));
    const result = await f.tools.get("schedule_reminder").execute({
        session: session(),
        deadline: Date.now() + 3600000,
        content: "stable",
        idempotency_key: "stable-new",
    });
    expect(result.status).toBe("success");
    expect(await f.store.get(result.result.id)).toMatchObject({ content: "stable" });
});

it("waits for database preparation after core readiness before recovery and polling", async (t) => {
    const f = await pendingCoreFixture(t, "", true);
    f.resolve();
    await new Promise<void>((done) => setImmediate(done));
    expect((await f.store.get(f.queued.id))?.status).toBe("queued");
    expect((await f.store.get(f.running.id))?.status).toBe("running");
    expect(f.tools.get("schedule_reminder").isSupported(session())).toBe(false);
    f.resolveDatabase();
    await f.ctx.lifecycle.flush();
    await vi.waitFor(async () => expect((await f.store.get(f.running.id))?.status).toBe("failed"));
});
