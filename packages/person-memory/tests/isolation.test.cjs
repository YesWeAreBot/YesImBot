const test = require("node:test");
const assert = require("node:assert/strict");
const { load, fixture, reopen } = require("./helpers.cjs");
const { PersonStore, registerModels } = load("store");

function wrap(db, intercept) {
    return new Proxy(db, {
        get(target, key) {
            if (key === "transact") return (fn) => target.transact((tx) => fn(wrap(tx, intercept)));
            if (key === "create") return (table, data) => intercept(target, table, data);
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
}
for (const operation of ["edit", "capture"])
    test(`${operation} failure cannot roll back an accepted independent core message`, async (t) => {
        const ctx = await fixture(t, (app) => {
            registerModels(app);
            app.model.extend("core_messages", { id: "string", content: "text" }, { primary: "id" });
        });
        const store = new PersonStore(ctx.database, "review");
        await store.recognize("s", "u", "Alice");
        let active = true;
        const guarded = new PersonStore(
            wrap(ctx.database, async (db, table, data) => {
                if (table === "person_memory.audit" || table === "person_memory.commits" || table === "person_memory.sources") {
                    await ctx.database.create("core_messages", { id: "accepted", content: "other channel" });
                    assert.equal((await ctx.database.get("core_messages", {})).length, 1);
                    if (operation === "edit") throw new Error("audit unavailable");
                    active = false;
                    throw new Error("任务已取消");
                }
                return db.create(table, data);
            }),
            "review",
        );
        await assert.rejects(
            operation === "edit"
                ? guarded.setProfile("s", "u", "must not commit", "admin")
                : guarded.capture("s", { id: "m", userId: "u", name: "Alice", text: "source", timestamp: 1 }, () => active),
        );
        assert.equal((await ctx.database.get("core_messages", {})).length, 1, "accepted core message survives person failure");
        assert.equal((await store.find("s", "u")).person.profile, "");
        assert.equal((await store.history("s")).length, 1);
        assert.equal((await store.sources("s", "u")).length, 0);
    });

test("legacy migration anchor rebuilds a missing cache without changing old audit or revert", async (t) => {
    let ctx = await fixture(t, (app) => {
        // Pre-format database schema, not just an old row in a new table.
        app.model.extend("person_memory.state", { scope: "string", revision: "unsigned", state: "json" }, { primary: "scope" });
        app.model.extend(
            "person_memory.sources",
            { key: "string", scope: "string", userId: "string", timestamp: "double", source: "json" },
            { primary: "key" },
        );
        app.model.extend(
            "person_memory.audit",
            { id: "string", scope: "string", timestamp: "double", revision: "unsigned", actor: "string", action: "string", changes: "json" },
            { primary: "id" },
        );
    });
    const state = {
        people: { p: { id: "p", name: "Old", profile: "legacy", evidence: [], provisional: false, stale: false, locked: false, revision: 5 } },
        accounts: {},
        proposals: {},
        linkProposals: {},
        settings: { mode: "auto", paused: false },
    };
    await ctx.database.create("person_memory.state", { scope: "old", revision: 5, state });
    await ctx.database.create("person_memory.audit", {
        id: "old-uuid",
        scope: "old",
        revision: 5,
        timestamp: 1,
        actor: "old-admin",
        action: "profile",
        changes: [{ collection: "people", key: "p", before: { ...state.people.p, profile: "" }, after: state.people.p }],
    });
    ctx = await reopen(ctx, registerModels);
    const store = new PersonStore(ctx.database, "off");
    await store.rename("old", "p", "New", "admin");
    const rename = (await store.history("old"))[0];
    assert.deepEqual(
        rename.changes.map((c) => c.collection),
        ["people"],
    );
    assert.equal(rename.baseline.revision, 5);
    await ctx.database.remove("person_memory.state", { scope: "old" });
    assert.equal((await store.read("old")).settings.mode, "auto");
    assert.equal((await store.find("old", "p")).person.name, "New");
    assert.equal((await store.audit("old", "old-uuid")).action, "profile");
    await store.revert("old", rename.id, "admin");
    assert.equal((await store.find("old", "p")).person.name, "Old");
    assert.equal((await store.find("old", "p")).person.profile, "legacy");
});

test("read repairs failed cache refresh while preserving committed defaults and audit", async (t) => {
    const ctx = await fixture(t, registerModels);
    const db = new Proxy(ctx.database, {
        get(target, key) {
            if (key === "set")
                return async (table, ...args) => {
                    if (table === "person_memory.state") throw new Error("cache unavailable");
                    return target.set(table, ...args);
                };
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    const store = new PersonStore(db, "review");
    await store.recognize("s", "u", "Alice");
    assert.equal((await ctx.database.get("person_memory.state", {})).length, 0);
    const restored = new PersonStore(ctx.database, "off");
    assert.equal((await restored.read("s")).settings.mode, "review");
    assert.equal((await restored.history("s")).length, 1);
    assert.equal((await ctx.database.get("person_memory.state", {}))[0]?.revision, 1);
});

function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
test("two independent stores arbitrate the same revision with a unique SQLite INSERT", async (t) => {
    const ctx = await fixture(t, registerModels),
        store = new PersonStore(ctx.database, "review");
    await store.recognize("s", "old", "Old");
    let arrivals = 0,
        collisions = 0;
    const both = deferred();
    const connection = () =>
        wrap(ctx.database, async (db, table, data) => {
            if (table === "person_memory.audit" && data.revision === 2) {
                if (++arrivals === 2) both.resolve();
                await both.promise;
            }
            try {
                return await db.create(table, data);
            } catch (error) {
                if (table === "person_memory.audit") collisions++;
                throw error;
            }
        });
    const left = new PersonStore(connection(), "review"),
        right = new PersonStore(connection(), "review");
    await Promise.all([left.recognize("s", "a", "A"), right.recognize("s", "b", "B")]);
    assert.equal(collisions, 1);
    assert.equal(Object.keys((await store.read("s")).accounts).length, 3);
    assert.deepEqual(
        (await store.history("s")).map((a) => a.revision),
        [3, 2, 1],
    );
});

test("a delayed cache write may regress but reads replay committed state and repair it", async (t) => {
    const ctx = await fixture(t, registerModels),
        store = new PersonStore(ctx.database, "review");
    await store.recognize("s", "old", "Old");
    const started = deferred(),
        release = deferred();
    const db = new Proxy(ctx.database, {
        get(target, key) {
            if (key === "set")
                return async (table, query, data) => {
                    if (table === "person_memory.state" && data.revision === 2) {
                        started.resolve();
                        await release.promise;
                    }
                    return target.set(table, query, data);
                };
            const value = target[key];
            return typeof value === "function" ? value.bind(target) : value;
        },
    });
    const first = new PersonStore(db, "review").recognize("s", "a", "A");
    await started.promise;
    await new PersonStore(ctx.database, "review").recognize("s", "b", "B");
    release.resolve();
    await first;
    assert.equal((await ctx.database.get("person_memory.state", { scope: "s" }))[0].revision, 2);
    assert.equal(Object.keys((await store.read("s")).accounts).length, 3);
    assert.equal((await ctx.database.get("person_memory.state", { scope: "s" }))[0].revision, 3);
    await ctx.database.remove("person_memory.state", { scope: "s" });
    assert.equal(Object.keys((await new PersonStore(ctx.database, "off").read("s")).accounts).length, 3);
});

for (const operation of ["recognize", "capture"])
    test(`${operation} cancellation before INSERT leaves no accepted state`, async (t) => {
        const ctx = await fixture(t, registerModels);
        let active = true,
            writes = 0;
        const db = new Proxy(ctx.database, {
            get(target, key) {
                if (key === "get")
                    return async (table, ...args) => {
                        const value = await target.get(table, ...args);
                        active = false;
                        return value;
                    };
                if (key === "create")
                    return async (...args) => {
                        writes++;
                        return target.create(...args);
                    };
                const value = target[key];
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
        const store = new PersonStore(db, "review");
        await assert.rejects(
            operation === "recognize"
                ? store.recognize("s", "u", "U", () => active)
                : store.capture("s", { id: "m", userId: "u", name: "U", text: "source", timestamp: 1 }, () => active),
            /取消/,
        );
        assert.equal(writes, 0);
        assert.equal((await ctx.database.get("person_memory.audit", {})).length, 0);
        assert.equal((await ctx.database.get("person_memory.sources", {})).length, 0);
    });

test("concurrent duplicate sources never replace original evidence", async (t) => {
    const ctx = await fixture(t, registerModels);
    const both = deferred();
    let arrivals = 0;
    const connection = () =>
        wrap(ctx.database, async (db, table, data) => {
            if (table === "person_memory.sources") {
                if (++arrivals === 2) both.resolve();
                await both.promise;
            }
            return db.create(table, data);
        });
    const first = { id: "m", userId: "u", name: "U", text: "original", timestamp: 1 };
    await Promise.all([
        new PersonStore(connection(), "review").capture("s", first),
        new PersonStore(connection(), "review").capture("s", { ...first, userId: "forged", text: "forged" }),
    ]);
    assert.deepEqual((await new PersonStore(ctx.database, "review").sources("s", "u"))[0], first);
    assert.equal((await ctx.database.get("person_memory.sources", {})).length, 1);
});

// Compile the actual source class so this regression does not depend on a
// previously generated core/lib tree being present or up to date.
const { WorldStateService } = (() => {
    const path = require("node:path"),
        Module = require("node:module");
    const filename = path.resolve(__dirname, "../../core/src/services/worldstate/service.ts");
    const result = require("esbuild").buildSync({ entryPoints: [filename], bundle: true, write: false, platform: "node", format: "cjs", packages: "external" });
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    mod._compile(result.outputFiles[0].text, filename);
    return mod.exports;
})();
const retentionTables = ["worldstate.messages", "worldstate.system_events", "worldstate.l2_chunks"];
function retentionModels(app) {
    registerModels(app);
    for (const table of retentionTables)
        app.model.extend(
            table,
            {
                id: "string",
                timestamp: "timestamp",
                endTimestamp: "timestamp",
                content: "text",
            },
            { primary: "id" },
        );
}
function retentionService(db) {
    const errors = [];
    let pruned = 0;
    const service = Object.create(WorldStateService.prototype);
    Object.assign(service, {
        ctx: { database: db },
        config: { dataRetentionDays: 1 },
        l1_manager: {
            pruneOldData: async () => {
                pruned++;
            },
        },
        logger: { info() {}, error: (...args) => errors.push(args) },
    });
    return { service, errors, pruned: () => pruned };
}

test("actual core retention failure cannot roll back accepted person commit or core message", async (t) => {
    const ctx = await fixture(t, retentionModels);
    const old = new Date(Date.now() - 2 * 86400000),
        recent = new Date();
    for (const table of retentionTables) await ctx.database.create(table, { id: "expired", timestamp: old, endTimestamp: old, content: "expired" });
    const started = deferred(),
        release = deferred();
    function intercept(db) {
        return new Proxy(db, {
            get(target, key) {
                if (key === "transact") return (fn) => target.transact((tx) => fn(intercept(tx)));
                if (key === "remove")
                    return async (table, ...args) => {
                        if (table === retentionTables[1]) {
                            started.resolve();
                            await release.promise;
                            throw new Error("retention unavailable");
                        }
                        return target.remove(table, ...args);
                    };
                const value = target[key];
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
    }
    const { service, errors, pruned } = retentionService(intercept(ctx.database));
    const cleanup = service.clear();
    await started.promise; // First remove ran; the second will fail after accepted writes.
    const store = new PersonStore(ctx.database, "review");
    await store.recognize("s", "u", "U");
    await ctx.database.create(retentionTables[0], { id: "accepted", timestamp: recent, endTimestamp: recent, content: "other channel" });
    assert.equal((await ctx.database.get("person_memory.audit", {})).length, 1);
    assert.equal((await ctx.database.get(retentionTables[0], { id: "accepted" })).length, 1);
    release.resolve();
    await cleanup;
    assert.equal(errors.length, 1);
    assert.equal(pruned(), 0);
    assert.deepEqual(
        { core: (await ctx.database.get(retentionTables[0], { id: "accepted" })).length, person: (await ctx.database.get("person_memory.audit", {})).length },
        { core: 1, person: 1 },
        "core message and person commit accepted during cleanup survive",
    );
    assert.ok(await store.find("s", "u"));
    assert.equal((await ctx.database.get(retentionTables[0], { id: "expired" })).length, 0, "completed retention deletion remains committed");
    // Next scheduled run retries the remaining idempotent deletions.
    const retry = retentionService(ctx.database);
    await retry.service.clear();
    assert.equal(retry.errors.length, 0);
    assert.equal(retry.pruned(), 1);
    for (const table of retentionTables) assert.equal((await ctx.database.get(table, { id: "expired" })).length, 0);
    assert.equal((await ctx.database.get(retentionTables[0], { id: "accepted" })).length, 1);
});

test("actual core retention success deletes expired records and keeps recent records in all three tables", async (t) => {
    const ctx = await fixture(t, retentionModels);
    const old = new Date(Date.now() - 2 * 86400000),
        recent = new Date();
    for (const table of retentionTables) {
        await ctx.database.create(table, { id: "expired", timestamp: old, endTimestamp: old, content: "expired" });
        await ctx.database.create(table, { id: "recent", timestamp: recent, endTimestamp: recent, content: "recent" });
    }
    const { service, errors, pruned } = retentionService(ctx.database);
    await service.clear();
    assert.deepEqual(errors, []);
    assert.equal(pruned(), 1);
    for (const table of retentionTables)
        assert.deepEqual(
            (await ctx.database.get(table, {})).map((row) => row.id),
            ["recent"],
        );
});
