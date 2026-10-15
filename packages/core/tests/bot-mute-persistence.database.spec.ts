import assert from "node:assert/strict";

import memory from "@koishijs/plugin-database-memory";
import { Context } from "koishi";
import { test } from "vitest";

import { WorldStateService } from "../src/world/service";
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

test("registered mute schema survives database retention, restart and manual history clear", async (t) => {
    const app = new Context();
    app.plugin(memory);
    t.onTestFinished(() => app.stop());
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
    const final = restart();
    await final.initializeMuteStatus();
    assert.equal(final.isBotMuted("onebot:g", "b"), false);
    assert.equal(final.isBotMuted("onebot:g", "a"), true);
});
