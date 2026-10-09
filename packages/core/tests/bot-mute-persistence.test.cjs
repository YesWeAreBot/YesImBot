const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Context } = require("koishi");
const sqlite = require("@minatojs/driver-sqlite").default;

// The Minato sql.js driver needs Node's WASM/filesystem behavior. Bun discovers
// CJS tests too, so delegate this integration rather than skipping its assertions.
const sqliteTest =
    typeof globalThis.Bun === "undefined"
        ? test
        : (name) =>
              test(name, () => {
                  execFileSync("node", ["--test", __filename], { encoding: "utf8", timeout: 30000 });
              });

function loadSource() {
    const file = path.join(__dirname, "../src/services/worldstate/service.ts");
    const js = buildSync({
        entryPoints: [file],
        bundle: true,
        write: false,
        platform: "node",
        format: "cjs",
        packages: "external",
        tsconfig: path.join(__dirname, "../tsconfig.json"),
    }).outputFiles[0].text;
    const mod = new Module(file, module);
    mod.filename = file;
    mod.paths = Module._nodeModulePaths(path.dirname(file));
    mod._compile(js, file);
    return mod.exports.WorldStateService;
}
const WorldStateService = loadSource();
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const event = (id, type, timestamp, user = "a", selfId = "a") => ({
    id,
    platform: "onebot",
    channelId: "g",
    type,
    timestamp: new Date(timestamp),
    message: "notice",
    payload: { details: { user: { id: user }, selfId, duration: 30 * 86400000 } },
});

sqliteTest("registered mute schema survives real SQLite retention, restart and manual history clear", async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yib-mute-state-"));
    let app = new Context({ baseDir: root });
    app.plugin(sqlite, { path: path.join(root, "state.db") });
    t.after(async () => {
        await app.stop();
        fs.rmSync(root, { recursive: true, force: true });
    });
    const ctx = {
        model: app.model,
        bots: [
            { platform: "onebot", selfId: "a" },
            { platform: "onebot", selfId: "b" },
        ],
        emit() {},
    };
    const restart = () => {
        const world = Object.create(WorldStateService.prototype);
        Object.defineProperties(world, { ctx: { value: ctx }, logger: { value: logger } });
        Object.assign(world, {
            mutedChannels: new Map(),
            allMutedChannels: new Map(),
            l1_manager: { recordSystemEvent: (row) => ctx.database.create("worldstate.system_events", row) },
            l2_manager: {
                getHistoryGeneration: () => 0,
                writeMemory: async (_target, _generation, write) => {
                    await write();
                    return true;
                },
            },
        });
        return world;
    };
    const reopen = async () => {
        await app.stop();
        app = new Context({ baseDir: root });
        app.plugin(sqlite, { path: path.join(root, "state.db") });
        ctx.model = app.model;
        restart().registerModels();
        await app.start();
        await app.database.prepared();
        ctx.database = app.database;
    };
    const world = restart();
    world.registerModels();
    await app.start();
    await app.database.prepared();
    ctx.database = app.database;
    const old = Date.now() - 8 * 86400000;
    await app.database.create("worldstate.system_events", event("individual", "guild-member-ban", old));
    await app.database.create("worldstate.system_events", event("all", "guild-all-member-ban", old, "0", "b"));
    await world.initializeMuteStatus();
    await app.database.remove("worldstate.system_events", { timestamp: { $lt: new Date(Date.now() - 7 * 86400000) } });
    await reopen();
    const restarted = restart();
    await restarted.initializeMuteStatus();
    assert.equal(restarted.isBotMuted("onebot:g", "a"), true);
    assert.equal(restarted.isBotMuted("onebot:g", "b"), true);
    const stored = await app.database.get("worldstate.bot_mute_state", {});
    assert.equal(stored.length, 2);
    assert.equal(
        stored.every((row) => /^[0-9a-f]{64}$/.test(row.id) && Number.isFinite(row.expiresAt)),
        true,
    );
    assert.equal(stored.find((row) => row.kind === "all").permanent, true);
    await restarted.updateMuteStatus("onebot:g", 0, "b", "all");
    await restarted.recordSystemEvent(event("release", "guild-all-member-unban", Date.now(), "0", "b"));
    await app.database.remove("worldstate.system_events", {});
    await reopen();
    const final = restart();
    await final.initializeMuteStatus();
    assert.equal(final.isBotMuted("onebot:g", "b"), false);
    assert.equal(final.isBotMuted("onebot:g", "a"), true);
});
