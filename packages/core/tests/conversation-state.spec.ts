import memory from "@koishijs/plugin-database-memory";
import { Bot, Context } from "koishi";
import { expect, it, onTestFinished } from "vitest";

import MemoryExtension from "../src/extension/builtin/memory";
import { TableName } from "../src/shared/constants";
import { SemanticMemoryManager } from "../src/world/l2-semantic-memory";
import { WorldStateService } from "../src/world/service";

const target = { platform: "onebot", channelId: "room", channelType: "guild" as const };
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const source = (id: string, extra = {}) => ({ ...target, id, sender: { id: "alice" }, timestamp: new Date("2026-01-01"), content: id, ...extra });
const update = { expectedRevision: 0, topic: "Plan Saturday", openIssues: ["Choose a time"], sourceMessageIds: ["a"] };
function deferred() {
    let resolve!: () => void;
    return { promise: new Promise<void>((r) => (resolve = r)), resolve: () => resolve() };
}
async function fixture() {
    const app = new Context();
    app.plugin(memory);
    (WorldStateService.prototype as any).registerModels.call({ ctx: app });
    await app.start();
    await app.database.prepared();
    onTestFinished(() => app.stop());
    const session = (selfId = "bot", channelId = "room", channelType = 0) => {
        const bot = Object.assign(Object.create(Bot.prototype), { ctx: app, platform: "onebot", user: { id: selfId } });
        return bot.session({ type: "message", channel: { id: channelId, type: channelType }, user: { id: "alice" }, message: { id: "incoming" } });
    };
    const worlds: any[] = [];
    const world = (instance = "core-a") => {
        const config: any = {
            allowedChannels: [
                { platform: "onebot", type: "guild", id: "*" },
                { platform: "onebot", type: "private", id: "*" },
            ],
            l2_memory: { enabled: false },
        };
        const l2_manager = new SemanticMemoryManager(app, config, { getLogger: () => logger } as any, {} as any);
        const ctx: any = { database: app.database, filter: () => true, scope: { key: instance } };
        const result = Object.assign(Object.create(WorldStateService.prototype), { ctx, config, l2_manager });
        worlds.push(result);
        return result;
    };
    onTestFinished(() => {
        for (const w of worlds) w.conversationState?.dispose();
    });
    const w = world();
    return {
        app,
        world: w,
        restart: world,
        session,
        add: async (...rows: Array<ReturnType<typeof source>>) => {
            for (const r of rows) await app.database.create(TableName.Messages, r);
        },
    };
}
it("persists explicitly written topic and issues with verified original source IDs across managers", async () => {
    const f = await fixture();
    await f.add(source("a"));
    expect(await f.world.getConversationState(f.session())).toMatchObject({ unknown: true });
    const written = await f.world.updateConversationState(f.session(), update);
    expect(written).toMatchObject({ unknown: false, state: { revision: 1, topic: update.topic, openIssues: update.openIssues, sourceMessageIds: ["a"] } });
    expect(await f.restart().getConversationState(f.session())).toEqual(written);
});
it("isolates working state by core instance, bot, channel, and channel type", async () => {
    const f = await fixture();
    await f.add(source("a"));
    await f.world.updateConversationState(f.session(), update);
    for (const incoming of [f.session("other-bot"), f.session("bot", "elsewhere"), f.session("bot", "room", 1)])
        expect(await f.world.getConversationState(incoming)).toMatchObject({ unknown: true });
    expect(await f.restart("core-b").getConversationState(f.session())).toMatchObject({ unknown: true });
});
it("rejects missing, foreign, and malformed sources without accepting unverified state", async () => {
    const f = await fixture();
    await f.add(source("foreign", { channelId: "elsewhere" }), source("private", { channelType: "private" }));
    for (const sourceMessageIds of [["missing"], ["foreign"], ["private"], [], ["missing", "missing"], Array.from({ length: 11 }, (_, i) => String(i))])
        await expect(f.world.updateConversationState(f.session(), { ...update, sourceMessageIds })).rejects.toThrow(/来源|来源消息/);
    expect(await f.world.getConversationState(f.session())).toMatchObject({ unknown: true });
});
it("serializes optimistic revisions across managers and rejects stale replacement", async () => {
    const f = await fixture();
    await f.add(source("a"));
    const results = await Promise.allSettled([f.world.updateConversationState(f.session(), update), f.restart().updateConversationState(f.session(), update)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    await expect(f.world.updateConversationState(f.session(), update)).rejects.toThrow(/revision|版本/);
    const replaced = await f.world.updateConversationState(f.session(), { expectedRevision: 1, topic: "", openIssues: [], sourceMessageIds: [] });
    expect(replaced).toMatchObject({ unknown: true, state: { revision: 2, topic: "", openIssues: [], sourceMessageIds: [] } });
});
it("does not revive state after sources disappear across manager restart", async () => {
    const f = await fixture();
    await f.add(source("a"));
    await f.world.updateConversationState(f.session(), update);
    await f.app.database.remove(TableName.Messages, target);
    expect(await f.restart().getConversationState(f.session())).toMatchObject({ unknown: true });
});
it("rejects source ID reuse whose original raw content changed", async () => {
    const f = await fixture();
    await f.add(source("a"));
    await f.world.updateConversationState(f.session(), update);
    await f.app.database.set(TableName.Messages, { ...target, id: "a" }, { content: "different" });
    expect(await f.restart().getConversationState(f.session())).toMatchObject({ unknown: true });
});
it("invalidates persisted state on active clear even if identical sources are restored", async () => {
    const f = await fixture();
    await f.add(source("a"));
    await f.world.updateConversationState(f.session(), update);
    await f.world.l2_manager.clearHistory(target, () => f.app.database.remove(TableName.Messages, target));
    await f.add(source("a"));
    expect(await f.restart().getConversationState(f.session())).toMatchObject({ unknown: true });
});
it("rejects authorization changes during an asynchronous source read", async () => {
    const f = await fixture();
    await f.add(source("a"));
    const entered = deferred(),
        hold = deferred();
    const get = f.app.database.get.bind(f.app.database);
    f.app.database.get = (async (...args: any[]) => {
        const result = await (get as any)(...args);
        if (args[0] === TableName.Messages) {
            entered.resolve();
            await hold.promise;
        }
        return result;
    }) as any;
    const writing = f.world.updateConversationState(f.session(), update);
    await entered.promise;
    f.world.config.allowedChannels = [];
    hold.resolve();
    await expect(writing).rejects.toThrow(/授权|配置/);
});
it("rejects in-flight updates when history clear starts", async () => {
    const f = await fixture();
    await f.add(source("a"));
    const entered = deferred(),
        hold = deferred();
    const get = f.app.database.get.bind(f.app.database);
    f.app.database.get = (async (...args: any[]) => {
        const result = await (get as any)(...args);
        if (args[0] === TableName.Messages) {
            entered.resolve();
            await hold.promise;
        }
        return result;
    }) as any;
    const writing = f.world.updateConversationState(f.session(), update);
    await entered.promise;
    const clearing = f.world.l2_manager.clearHistory(target, () => f.app.database.remove(TableName.Messages, target));
    hold.resolve();
    await expect(writing).rejects.toThrow(/清除/);
    await clearing;
    expect(await f.restart().getConversationState(f.session())).toMatchObject({ unknown: true });
});
it("exposes explicit state read and update tools", async () => {
    const f = await fixture();
    await f.add(source("a"));
    const extension = Object.assign(Object.create(MemoryExtension.prototype), { ctx: { yesimbot: { world: f.world } } });
    const written: any = await extension.conversationStateUpdate({ session: f.session(), ...update });
    expect(written.status).toBe("success");
    expect((await extension.conversationStateRead({ session: f.session() })).result.state.topic).toBe(update.topic);
});
it("shares clear invalidation across managers without deleting a fresh revision", async () => {
    const f = await fixture();
    await f.add(source("a"));
    await f.world.updateConversationState(f.session(), update);
    const other = f.restart();
    await other.getConversationState(f.session());
    await f.world.l2_manager.clearHistory(target, () => f.app.database.remove(TableName.Messages, target));
    await f.add(source("fresh"));
    await f.world.updateConversationState(f.session(), { ...update, sourceMessageIds: ["fresh"] });
    expect((await other.getConversationState(f.session())).state?.topic).toBe(update.topic);
});
it("preserves state when a transient source database read fails", async () => {
    const f = await fixture();
    await f.add(source("a"));
    await f.world.updateConversationState(f.session(), update);
    const get = f.app.database.get.bind(f.app.database);
    let fail = true;
    f.app.database.get = (async (...args: any[]) => {
        if (args[0] === TableName.Messages && fail) {
            fail = false;
            throw new Error("temporary database error");
        }
        return (get as any)(...args);
    }) as any;
    await expect(f.world.getConversationState(f.session())).rejects.toThrow(/temporary/);
    expect((await f.world.getConversationState(f.session())).state?.topic).toBe(update.topic);
});
it("rolls back state if authorization is revoked while the persistent write completes", async () => {
    const f = await fixture();
    await f.add(source("a"));
    const entered = deferred(),
        hold = deferred();
    const upsert = f.app.database.upsert.bind(f.app.database);
    f.app.database.upsert = (async (...args: any[]) => {
        const result = await (upsert as any)(...args);
        if (args[0] === "worldstate.conversation_state") {
            entered.resolve();
            await hold.promise;
        }
        return result;
    }) as any;
    const writing = f.world.updateConversationState(f.session(), update);
    await entered.promise;
    f.world.ctx.filter = () => false;
    hold.resolve();
    await expect(writing).rejects.toThrow(/授权|配置/);
    expect(await f.restart().getConversationState(f.session())).toEqual({ unknown: true });
});
it("keeps known empty-clear revision available for subsequent optimistic updates", async () => {
    const f = await fixture();
    await f.add(source("a"));
    await f.world.updateConversationState(f.session(), update);
    await f.world.updateConversationState(f.session(), { expectedRevision: 1, sourceMessageIds: [] });
    const cleared = await f.restart().getConversationState(f.session());
    expect(cleared).toMatchObject({ unknown: true, state: { revision: 2, topic: "", openIssues: [] } });
    const fresh = await f.world.updateConversationState(f.session(), { ...update, expectedRevision: cleared.state.revision });
    expect(fresh.state.revision).toBe(3);
});
