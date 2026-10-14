import assert from "node:assert/strict";

import { test } from "vitest";

import { DirectoryStore } from "../src/store";
import { database } from "./helpers";

function bot(id, friends, members) {
    return { platform: "onebot", selfId: id, internal: { getFriendList: friends, getGroupMemberList: members } };
}
const member = (i) => ({ user_id: i, nickname: "N" + i });

test("friends are shared across private chats; groups are isolated and paginated", async (t) => {
    const ctx = await database(t);
    let friends = 0,
        groups = 0;
    const client = bot(
        "bot1",
        async () => {
            friends++;
            return [member(1), member(2)];
        },
        async (group) => {
            groups++;
            return group === "a" ? [member(3), member(4)] : [member(5)];
        },
    );
    const store = new DirectoryStore(ctx, 2, 1);
    const a = await store.query(client, { kind: "friends", limit: 1 });
    const b = await store.query(client, { kind: "friends", offset: 1, limit: 1 });
    assert.equal(friends, 1);
    assert.equal(a.entries[0].userId, "1");
    assert.equal(b.entries[0].userId, "2");
    const ga = await store.query(client, { kind: "members", groupId: "a", offset: 1 });
    const gb = await store.query(client, { kind: "members", groupId: "b" });
    assert.equal(groups, 2);
    assert.equal(ga.entries[0].userId, "4");
    assert.equal(gb.entries[0].userId, "5");
});

test("same group deduplicates, different groups run within concurrency limit", async (t) => {
    const ctx = await database(t);
    let active = 0,
        peak = 0,
        calls = 0;
    const client = bot(
        "bot1",
        async () => [],
        async () => {
            calls++;
            peak = Math.max(peak, ++active);
            await new Promise((resolve) => setTimeout(resolve, 15));
            active--;
            return [member(calls)];
        },
    );
    const store = new DirectoryStore(ctx, 2, 100);
    await Promise.all(["a", "a", "b", "c", "d"].map((groupId) => store.query(client, { kind: "members", groupId })));
    assert.equal(calls, 4);
    assert.equal(peak, 2);
});

test("failed database write never publishes partial refresh", async (t) => {
    const ctx = await database(t);
    let version = 0;
    const client = bot(
        "bot1",
        async () => (version++ ? [member(9), member(10)] : [member(7)]),
        async () => [],
    );
    const store = new DirectoryStore(ctx, 2, 1);
    await store.query(client, { kind: "friends" });
    const original = ctx.database.upsert;
    ctx.database.upsert = async (table, values) => {
        if (table.endsWith("_contacts") && values[0].userId === "10") throw new Error("db failure");
        return original(table, values);
    };
    await assert.rejects(store.query(client, { kind: "friends", refresh: true }), /db failure/);
    const old = await store.query(client, { kind: "friends" });
    assert.deepEqual(
        old.entries.map((x) => x.userId),
        ["7"],
    );
    assert.equal((await ctx.database.get("yesimbot.onebot_directory_contacts", {})).length, 1);
});

test("cached data never refreshes automatically; explicit updates replace a shared group", async (t) => {
    const ctx = await database(t);
    let calls = 0;
    const first = bot(
        "bot1",
        async () => [],
        async () => {
            calls++;
            return [member(1)];
        },
    );
    const second = bot(
        "bot2",
        async () => [],
        async () => {
            calls++;
            return [member(2)];
        },
    );
    const store = new DirectoryStore(ctx, 2, 100);
    const initial = await store.query(first, { kind: "members", groupId: "g" });
    assert.equal(initial.entries[0].userId, "1");
    const reused = await store.query(second, { kind: "members", groupId: "g" });
    assert.equal(reused.entries[0].userId, "1");
    assert.equal(reused.sourceBotId, "bot1");
    assert.equal(calls, 1);
    const updated = await store.query(second, { kind: "members", groupId: "g", refresh: true });
    assert.equal(updated.entries[0].userId, "2");
    assert.equal(updated.sourceBotId, "bot2");
    assert.equal(calls, 2);
    assert.equal((await store.query(first, { kind: "members", groupId: "g" })).entries[0].userId, "2");
});

test("friends remain separate for each bot", async (t) => {
    const ctx = await database(t);
    const store = new DirectoryStore(ctx, 2, 100);
    const a = bot(
        "bot1",
        async () => [member(1)],
        async () => [],
    );
    const b = bot(
        "bot2",
        async () => [member(2)],
        async () => [],
    );
    assert.equal((await store.query(a, { kind: "friends" })).entries[0].userId, "1");
    assert.equal((await store.query(b, { kind: "friends" })).entries[0].userId, "2");
});

test("summary and exact user lookup do not return a full page", async (t) => {
    const ctx = await database(t);
    const store = new DirectoryStore(ctx, 2, 100);
    const client = bot(
        "bot1",
        async () => [],
        async () => [member(3), member(4), member(5)],
    );
    const summary = await store.query(client, { kind: "members", groupId: "g", summaryOnly: true });
    assert.equal(summary.total, 3);
    assert.equal(summary.entries.length, 0);
    const found = await store.query(client, { kind: "members", groupId: "g", userId: "4" });
    assert.deepEqual(
        found.entries.map((x) => x.userId),
        ["4"],
    );
});

test("large group is written in bounded batches and queried by page", async (t) => {
    const ctx = await database(t);
    const sizes = [];
    const original = ctx.database.upsert;
    ctx.database.upsert = async (table, rows) => {
        if (table.endsWith("_contacts")) sizes.push(rows.length);
        return original(table, rows);
    };
    const client = bot(
        "bot1",
        async () => [],
        async () => Array.from({ length: 2005 }, (_, i) => member(i + 1)),
    );
    const store = new DirectoryStore(ctx, 2, 100);
    const result = await store.query(client, { kind: "members", groupId: "large", offset: 1999, limit: 6 });
    assert.equal(result.total, 2005);
    assert.deepEqual(
        result.entries.map((x) => x.userId),
        ["2000", "2001", "2002", "2003", "2004", "2005"],
    );
    assert.equal(Math.max(...sizes), 100);
    assert.equal(sizes.length, 21);
}, 30000);

test("an initial adapter failure leaves no published snapshot", async (t) => {
    const ctx = await database(t);
    const client = bot(
        "bot1",
        async () => {
            throw new Error("offline");
        },
        async () => [],
    );
    const store = new DirectoryStore(ctx, 2, 100);
    await assert.rejects(store.query(client, { kind: "friends" }), /offline/);
    assert.equal((await ctx.database.get("yesimbot.onebot_directory_snapshots", {})).length, 0);
});

test("two bots concurrently querying one group share the same first fetch", async (t) => {
    const ctx = await database(t);
    let calls = 0;
    const fetchMembers = async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [member(42)];
    };
    const store = new DirectoryStore(ctx, 2, 100);
    const a = bot("bot1", async () => [], fetchMembers);
    const b = bot("bot2", async () => [], fetchMembers);
    const [first, second] = await Promise.all([store.query(a, { kind: "members", groupId: "shared" }), store.query(b, { kind: "members", groupId: "shared" })]);
    assert.equal(calls, 1);
    assert.equal(first.entries[0].userId, "42");
    assert.equal(second.entries[0].userId, "42");
});

test("stopping during an adapter fetch cannot publish a new snapshot", async (t) => {
    const ctx = await database(t);
    let release;
    const client = bot(
        "bot1",
        async () =>
            new Promise((resolve) => {
                release = () => resolve([member(1)]);
            }),
        async () => [],
    );
    const store = new DirectoryStore(ctx, 2, 100);
    const task = store.query(client, { kind: "friends" });
    await new Promise((resolve) => setImmediate(resolve));
    store.stop();
    release();
    await assert.rejects(task, /已关闭/);
    assert.equal((await ctx.database.get("yesimbot.onebot_directory_snapshots", {})).length, 0);
});
