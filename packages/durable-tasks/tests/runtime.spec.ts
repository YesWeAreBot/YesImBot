import memory from "@koishijs/plugin-database-memory";
import pluginMock from "@koishijs/plugin-mock";
import { Context } from "koishi";
import { expect, it, vi, type TestContext } from "vitest";
vi.mock("koishi-plugin-yesimbot/shared", () => ({
    getInstanceScope: (_ctx: Context, _warn: unknown, options?: unknown) => (options ? "plugin-scope" : "core-scope"),
}));
import * as plugin from "../src/index";
import { TABLE } from "../src/store";
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
    ctx.set("yesimbot.tool", {
        capabilities: { trustedToolSession: 1 },
        registerTool: (tool: any) => {
            tools.set(tool.name, tool);
            return () => tools.delete(tool.name);
        },
    });
    ctx.set("yesimbot.world-state", world);
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
    ctx.set("yesimbot.tool", {
        capabilities: { trustedToolSession: 1 },
        registerTool: (tool: any) => {
            tools.set(tool.name, tool);
            return () => tools.delete(tool.name);
        },
    });
    const recordSystemEvent = vi.fn<(...args: any[]) => Promise<boolean>>(async () => true);
    ctx.set("yesimbot.world-state", {
        stimulusOwnerId: "world",
        isChannelAllowed: () => true,
        isBotMuted: () => false,
        l2_manager: { getHistoryGeneration: () => 0 },
        recordSystemEvent,
    });
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
