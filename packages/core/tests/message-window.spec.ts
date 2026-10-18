import memory from "@koishijs/plugin-database-memory";
import { Bot, Context } from "koishi";
import { expect, it, onTestFinished } from "vitest";

import MemoryExtension from "../src/extension/builtin/memory";
import { TableName } from "../src/shared/constants";
import { SemanticMemoryManager } from "../src/world/l2-semantic-memory";
import { WorldStateService } from "../src/world/service";

const target = { platform: "onebot", channelId: "room", channelType: "guild" as const };
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const row = (id: string, extra = {}) => ({
    ...target,
    id,
    sender: { id: "alice" },
    timestamp: new Date("2026-01-01"),
    content: `<message>${id}<img src="asset:raw"/></message>`,
    ...extra,
});
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
    const bot = Object.assign(Object.create(Bot.prototype), { ctx: app, platform: "onebot", user: { id: "bot" } });
    const session = bot.session({ type: "message", channel: { id: "room", type: 0 }, user: { id: "alice" }, message: { id: "incoming" } });
    const logging = { getLogger: () => logger };
    const config: any = { allowedChannels: [{ platform: "onebot", type: "guild", id: "room" }], l2_memory: { enabled: false } };
    const l2_manager = new SemanticMemoryManager(app, config, logging as any, {} as any);
    const world = Object.assign(Object.create(WorldStateService.prototype), { ctx: app, config, l2_manager });
    return {
        app,
        world,
        session,
        l2_manager,
        add: async (...rows: Array<ReturnType<typeof row>>) => {
            for (const r of rows) await app.database.create(TableName.Messages, r);
        },
    };
}
it("reads only current-target anchor with deterministic same-timestamp neighbors and complete raw content", async () => {
    const f = await fixture();
    await f.add(row("c"), row("a"), row("b"), row("b", { channelId: "elsewhere", content: "secret" }), row("b", { platform: "qq", content: "secret" }));
    const result = await f.world.readMessageWindow(f.session, { messageId: "b", before: 1, after: 1 });
    expect(result.records.map((r: any) => r.id)).toEqual(["a", "b", "c"]);
    expect(result.anchorId).toBe("b");
    expect(result.anchor.content).toBe(row("b").content);
    expect(result.contentTruncated).toBe(false);
    expect(result.records[1].sourceIdentity).toEqual({
        platform: "onebot",
        channelId: "room",
        channelType: "guild",
        messageId: "b",
        ownership: "shared-history",
    });
    const again = await f.world.readMessageWindow(f.session, { messageId: "b" });
    expect(again.anchor.evidenceKey).toBe(result.anchor.evidenceKey);
    expect(result.projection).toEqual({ kind: "recalled", isNewEvidence: false });
});
it("never falls back to another target for anchors or quoted messages", async () => {
    const f = await fixture();
    await f.add(row("foreign", { channelId: "elsewhere" }), row("anchor", { quoteId: "foreign" }), row("reply", { quoteId: "anchor" }));
    await expect(f.world.readMessageWindow(f.session, { messageId: "foreign" })).rejects.toThrow(/不存在/);
    const page = await f.world.readMessageWindow(f.session, { messageId: "reply", before: 0, after: 0 });
    expect(page.quotes[0]).toMatchObject({ messageId: "reply", quoteId: "anchor", missing: false, record: { id: "anchor" } });
    const missing = await f.world.readMessageWindow(f.session, { messageId: "anchor", before: 0, after: 0 });
    expect(missing.quotes).toEqual([{ messageId: "anchor", quoteId: "foreign", missing: true }]);
});
it("paginates bounded windows without losing the anchor or silently discarding neighbors", async () => {
    const f = await fixture();
    await f.add(...Array.from({ length: 105 }, (_, i) => row(String(i).padStart(3, "0"))));
    const records: any[] = [];
    let offset = 0;
    for (;;) {
        const page = await f.world.readMessageWindow(f.session, { messageId: "052", before: 50, after: 50, offset });
        expect(page.anchor.id).toBe("052");
        expect(page.returned).toBeLessThanOrEqual(20);
        expect(page.total).toBe(101);
        expect(page.before).toMatchObject({ selected: 50, hasMore: true, nextAnchorId: "002" });
        expect(page.after).toMatchObject({ selected: 50, hasMore: true, nextAnchorId: "102" });
        records.push(...page.records);
        if (!page.hasMore) break;
        offset = page.nextOffset;
    }
    expect(records.map((r) => r.id)).toEqual(Array.from({ length: 101 }, (_, i) => String(i + 2).padStart(3, "0")));
    for (const bad of [{ before: 51 }, { after: -1 }, { offset: 0.5 }, { limit: 21 }])
        await expect(f.world.readMessageWindow(f.session, { messageId: "052", ...bad })).rejects.toThrow(/窗口|分页/);
});
it("rejects permission revocation after an asynchronous read", async () => {
    const f = await fixture();
    await f.add(row("a"));
    const entered = deferred(),
        hold = deferred();
    const get = f.app.database.get.bind(f.app.database);
    f.app.database.get = (async (...args: any[]) => {
        const result = await (get as any)(...args);
        entered.resolve();
        await hold.promise;
        return result;
    }) as any;
    const reading = f.world.readMessageWindow(f.session, { messageId: "a" });
    await entered.promise;
    f.world.config.allowedChannels = [];
    hold.resolve();
    await expect(reading).rejects.toThrow(/配置|授权/);
});
it("invalidates in-flight reads before clear can delete history", async () => {
    const f = await fixture();
    await f.add(row("a"));
    const entered = deferred(),
        hold = deferred();
    const get = f.app.database.get.bind(f.app.database);
    f.app.database.get = (async (...args: any[]) => {
        const result = await (get as any)(...args);
        entered.resolve();
        await hold.promise;
        return result;
    }) as any;
    const reading = f.world.readMessageWindow(f.session, { messageId: "a" });
    await entered.promise;
    const clearing = f.l2_manager.clearHistory(target, () => f.app.database.remove(TableName.Messages, target));
    hold.resolve();
    await expect(reading).rejects.toThrow(/清除/);
    await clearing;
    expect(await f.app.database.get(TableName.Messages, target)).toHaveLength(0);
});
it("binds the session throughout an asynchronous read", async () => {
    const f = await fixture();
    await f.add(row("a"));
    const entered = deferred(),
        hold = deferred();
    const get = f.app.database.get.bind(f.app.database);
    f.app.database.get = (async (...args: any[]) => {
        const result = await (get as any)(...args);
        entered.resolve();
        await hold.promise;
        return result;
    }) as any;
    const reading = f.world.readMessageWindow(f.session, { messageId: "a" });
    await entered.promise;
    f.session.event.channel.id = "elsewhere";
    hold.resolve();
    await expect(reading).rejects.toThrow(/会话/);
});
it("conversation_read forwards only window options and trusted session", async () => {
    const f = await fixture();
    await f.add(row("a"));
    const extension = Object.assign(Object.create(MemoryExtension.prototype), { ctx: { yesimbot: { world: f.world } } });
    const result: any = await extension.conversationRead({ session: f.session, message_id: "a", before: 0, after: 0 } as any);
    expect(result.status).toBe("success");
    expect(result.result.anchor.id).toBe("a");
});
it("does not treat stored private or untyped messages as guild evidence", async () => {
    const f = await fixture();
    await f.add(row("private", { channelType: "private" }), row("legacy", { channelType: undefined }), row("guild", { quoteId: "private" }));
    for (const messageId of ["private", "legacy"]) await expect(f.world.readMessageWindow(f.session, { messageId })).rejects.toThrow(/不存在/);
    const page = await f.world.readMessageWindow(f.session, { messageId: "guild" });
    expect(page.records.map((r: any) => r.id)).toEqual(["guild"]);
    expect(page.quotes).toEqual([{ messageId: "guild", quoteId: "private", missing: true }]);
});
it("waits for restore and does not expose a half-restored history", async () => {
    const f = await fixture();
    await f.add(row("b"));
    const entered = deferred(),
        hold = deferred();
    const restoring = f.l2_manager.withHistoryBarrier(target, async () => {
        entered.resolve();
        await hold.promise;
        await f.add(row("a"));
    });
    await entered.promise;
    const reading = f.world.readMessageWindow(f.session, { messageId: "b" });
    hold.resolve();
    await restoring;
    expect((await reading).records.map((r: any) => r.id)).toEqual(["a", "b"]);
});
it("rechecks the owning context filter after database work", async () => {
    const f = await fixture();
    await f.add(row("a"));
    const entered = deferred(),
        hold = deferred();
    const get = f.app.database.get.bind(f.app.database);
    f.app.database.get = (async (...args: any[]) => {
        const result = await (get as any)(...args);
        entered.resolve();
        await hold.promise;
        return result;
    }) as any;
    const reading = f.world.readMessageWindow(f.session, { messageId: "a" });
    await entered.promise;
    f.app.filter = () => false;
    hold.resolve();
    await expect(reading).rejects.toThrow(/授权|配置/);
});
it("reports missing session and input errors through conversation_read", async () => {
    const f = await fixture();
    const extension = Object.assign(Object.create(MemoryExtension.prototype), { ctx: { yesimbot: { world: f.world } } });
    expect((await extension.conversationRead({ message_id: "a" })).status).toBe("error");
    const result = await extension.conversationRead({ session: f.session, message_id: "missing" });
    expect(result.status).toBe("error");
    expect(result.error.message).toMatch(/不存在/);
});
it("keeps raw source identity stable across bots sharing the same history", async () => {
    const f = await fixture();
    await f.add(row("a"));
    const first = await f.world.readMessageWindow(f.session, { messageId: "a" });
    const bot = Object.assign(Object.create(Bot.prototype), { ctx: f.app, platform: "onebot", user: { id: "other-bot" } });
    const other = bot.session({ type: "message", channel: { id: "room", type: 0 }, user: { id: "alice" }, message: { id: "incoming" } });
    const second = await f.world.readMessageWindow(other, { messageId: "a" });
    expect(second.target.selfId).toBe("other-bot");
    expect(second.anchor.evidenceKey).toBe(first.anchor.evidenceKey);
    expect(second.anchor.sourceIdentity).toEqual(first.anchor.sourceIdentity);
    expect(second.anchor.sourceIdentity).not.toHaveProperty("selfId");
});
