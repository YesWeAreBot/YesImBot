const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, database, gate } = require("./helpers.cjs");
const { DirectoryStore, CONTACTS, SNAPSHOTS } = load("store");
const args = { kind: "members", groupId: "g", all: true };
const bot = (id, users) => ({
    platform: "onebot",
    selfId: id,
    internal: { getGroupMemberList: async () => users.map((user_id) => ({ user_id, nickname: "N" + user_id })) },
});

test("slow SQLite reader survives two completed refreshes without silently losing its page", async (t) => {
    const ctx = await database(t),
        store = new DirectoryStore(ctx, 2, 1);
    await store.query(bot("old", [1, 2]), args);
    const entered = gate(),
        release = gate(),
        get = ctx.database.get;
    let pause = true;
    ctx.database.get = async (table, query, options) => {
        if (table === CONTACTS && pause) {
            pause = false;
            entered.resolve();
            await release.promise;
        }
        return get(table, query, options);
    };
    const slow = store.query(bot("old", []), args);
    await entered.promise;
    await store.query(bot("new1", [3, 4]), { ...args, refresh: true });
    await store.query(bot("new2", [5, 6]), { ...args, refresh: true });
    release.resolve();
    const result = await slow;
    assert.equal(result.returned, result.total);
    assert.deepEqual(
        result.entries.map((x) => x.userId),
        result.sourceBotId === "old" ? ["1", "2"] : ["5", "6"],
    );
});

test("independent stores cannot erase another store preparing a shared SQLite revision", async (t) => {
    const ctx = await database(t),
        first = new DirectoryStore(ctx, 2, 100),
        second = new DirectoryStore(ctx, 2, 100);
    await first.query(bot("initial", [1]), args);
    const entered = gate(),
        release = gate(),
        upsert = ctx.database.upsert;
    ctx.database.upsert = async (table, rows, ...rest) => {
        const result = await upsert(table, rows, ...rest);
        if (table === CONTACTS && rows.some((x) => x.userId === "2")) {
            entered.resolve();
            await release.promise;
        }
        return result;
    };
    const preparing = first.query(bot("A", [2]), { ...args, refresh: true });
    await entered.promise;
    await second.query(bot("B", [3]), { ...args, refresh: true });
    release.resolve();
    await preparing;
    const result = await second.query(bot("B", []), args);
    assert.equal(result.sourceBotId, "A");
    assert.deepEqual(
        result.entries.map((x) => x.userId),
        ["2"],
    );
    assert.equal((await ctx.database.get(SNAPSHOTS, {}))[0].total, result.returned);
});

function clock(t) {
    const original = Date.now;
    let time = original();
    Date.now = () => time;
    t.after(() => {
        Date.now = original;
    });
    return {
        advance(ms) {
            time += ms;
        },
    };
}

test("SQLite GC reclaims expired revisions and orphan preparations but keeps the published cache", async (t) => {
    const { REVISION_TTL_MS } = load("store");
    const time = clock(t),
        ctx = await database(t),
        store = new DirectoryStore(ctx, 2, 100);
    for (let i = 1; i <= 5; i++) await store.query(bot("bot", [i]), { ...args, refresh: true });
    const snapshot = (await ctx.database.get(SNAPSHOTS, {}))[0];
    await ctx.database.upsert(CONTACTS, [
        { ...(await ctx.database.get(CONTACTS, { revision: snapshot.revision }))[0], revision: "orphan", userId: "abandoned" },
    ]);
    assert.equal((await ctx.database.get(CONTACTS, {})).length, 6);
    time.advance(REVISION_TTL_MS + 1);
    const result = await store.query(bot("never-fetch", []), args);
    assert.deepEqual(
        result.entries.map((x) => x.userId),
        ["5"],
    );
    assert.equal((await ctx.database.get(CONTACTS, {})).length, 1);
    assert.equal(result.sourceBotId, "bot");
});

test("reader spanning TTL reclamation retries every page from the new complete revision", async (t) => {
    const { REVISION_TTL_MS } = load("store");
    const time = clock(t),
        ctx = await database(t),
        store = new DirectoryStore(ctx, 2, 1);
    await store.query(bot("old", [1, 2]), args);
    const entered = gate(),
        release = gate(),
        get = ctx.database.get;
    let pause = true;
    ctx.database.get = async (table, query, options) => {
        if (table === CONTACTS && options?.offset === 1 && pause) {
            pause = false;
            entered.resolve();
            await release.promise;
        }
        return get(table, query, options);
    };
    const reading = store.query(bot("old", []), args);
    await entered.promise;
    time.advance(REVISION_TTL_MS + 1);
    await store.query(bot("new", [3, 4]), { ...args, refresh: true });
    release.resolve();
    const result = await reading;
    assert.deepEqual(
        result.entries.map((x) => x.userId),
        ["3", "4"],
    );
    assert.equal(result.sourceBotId, "new");
});

test("preparation reclaimed after TTL fails rather than replacing a valid cache with missing contacts", async (t) => {
    const { REVISION_TTL_MS } = load("store");
    const time = clock(t),
        ctx = await database(t),
        first = new DirectoryStore(ctx, 2, 1),
        second = new DirectoryStore(ctx, 2, 1);
    await first.query(bot("initial", [1]), args);
    const entered = gate(),
        release = gate(),
        upsert = ctx.database.upsert;
    ctx.database.upsert = async (table, rows, ...rest) => {
        const result = await upsert(table, rows, ...rest);
        if (table === CONTACTS && rows[0].userId === "2") {
            entered.resolve();
            await release.promise;
        }
        return result;
    };
    const preparing = first.query(bot("expired", [2, 3]), { ...args, refresh: true });
    const failed = assert.rejects(preparing, /准备期间已过期/);
    await entered.promise;
    time.advance(REVISION_TTL_MS + 1);
    await second.query(bot("new", [4]), { ...args, refresh: true });
    release.resolve();
    await failed;
    const result = await first.query(bot("expired", []), args);
    assert.deepEqual(
        result.entries.map((x) => x.userId),
        ["4"],
    );
    assert.equal(result.sourceBotId, "new");
});

test("reclamation between validation and publication is detected and the next read repairs the cache", async (t) => {
    const { REVISION_TTL_MS } = load("store");
    const time = clock(t),
        ctx = await database(t),
        first = new DirectoryStore(ctx, 2, 100),
        second = new DirectoryStore(ctx, 2, 100);
    await first.query(bot("initial", [1]), args);
    const entered = gate(),
        release = gate(),
        upsert = ctx.database.upsert;
    let pause = true;
    ctx.database.upsert = async (table, rows, ...rest) => {
        if (table === SNAPSHOTS && rows[0].sourceBotId === "expired" && pause) {
            pause = false;
            entered.resolve();
            await release.promise;
        }
        return upsert(table, rows, ...rest);
    };
    const preparing = first.query(bot("expired", [2]), { ...args, refresh: true });
    const failed = assert.rejects(preparing, /准备期间已过期/);
    await entered.promise;
    time.advance(REVISION_TTL_MS + 1);
    await second.query(bot("new", [3]), { ...args, refresh: true });
    release.resolve();
    await failed;
    const damaged = (await ctx.database.get(SNAPSHOTS, {}))[0];
    assert.equal(damaged.sourceBotId, "expired");
    assert.equal((await ctx.database.get(CONTACTS, { revision: damaged.revision })).length, 0);
    const repaired = await second.query(bot("repair", [4]), args);
    assert.equal(repaired.sourceBotId, "repair");
    assert.deepEqual(
        repaired.entries.map((x) => x.userId),
        ["4"],
    );
    assert.deepEqual(
        (await first.query(bot("cached", []), args)).entries.map((x) => x.userId),
        ["4"],
    );
});

test("legacy dangling cache is repaired even for summary or exact lookup misses", async (t) => {
    const ctx = await database(t),
        store = new DirectoryStore(ctx, 2, 100);
    await store.query(bot("legacy", [1]), args);
    await ctx.database.remove(CONTACTS, {});
    const summary = await store.query(bot("repair", [2]), { ...args, summaryOnly: true });
    assert.equal(summary.total, 1);
    assert.equal(summary.sourceBotId, "repair");
    await ctx.database.remove(CONTACTS, {});
    const lookup = await store.query(bot("repair2", [2]), { ...args, userId: "2" });
    assert.deepEqual(
        lookup.entries.map((x) => x.userId),
        ["2"],
    );
});

test("continuous concurrent publication stops after three read attempts with a clear error", async (t) => {
    const ctx = await database(t),
        reader = new DirectoryStore(ctx, 2, 100),
        writer = new DirectoryStore(ctx, 2, 100);
    await reader.query(bot("initial", [1]), args);
    const get = ctx.database.get;
    let pages = 0;
    ctx.database.get = async (table, query, options) => {
        const result = await get(table, query, options);
        if (table === CONTACTS) {
            pages++;
            await writer.query(bot("writer", [pages + 1]), { ...args, refresh: true, summaryOnly: true });
        }
        return result;
    };
    await assert.rejects(reader.query(bot("reader", []), args), /持续更新，请稍后重试/);
    assert.equal(pages, 3);
});

test("post-publication database validation errors do not erase a complete cached revision", async (t) => {
    const ctx = await database(t),
        store = new DirectoryStore(ctx, 2, 100);
    await store.query(bot("initial", [1]), args);
    const evaluate = ctx.database.eval;
    let validations = 0;
    ctx.database.eval = async (...input) => {
        if (++validations === 2) throw new Error("temporary count failure");
        return evaluate(...input);
    };
    await assert.rejects(store.query(bot("published", [2]), { ...args, refresh: true }), /temporary count failure/);
    ctx.database.eval = evaluate;
    const offline = bot("offline", []);
    offline.internal.getGroupMemberList = async () => {
        throw new Error("must use complete cache");
    };
    const cached = await store.query(offline, args);
    assert.equal(cached.sourceBotId, "published");
    assert.deepEqual(
        cached.entries.map((x) => x.userId),
        ["2"],
    );
});

test("snapshot upsert committed before rejecting still preserves its complete cached contacts", async (t) => {
    const ctx = await database(t),
        store = new DirectoryStore(ctx, 2, 100);
    await store.query(bot("initial", [1]), args);
    const upsert = ctx.database.upsert;
    ctx.database.upsert = async (table, rows, ...rest) => {
        const result = await upsert(table, rows, ...rest);
        if (table === SNAPSHOTS && rows[0].sourceBotId === "committed") throw new Error("lost commit response");
        return result;
    };
    await assert.rejects(store.query(bot("committed", [2]), { ...args, refresh: true }), /lost commit response/);
    const offline = bot("offline", []);
    offline.internal.getGroupMemberList = async () => {
        throw new Error("must use complete cache");
    };
    const cached = await store.query(offline, args);
    assert.equal(cached.sourceBotId, "committed");
    assert.deepEqual(
        cached.entries.map((x) => x.userId),
        ["2"],
    );
});
