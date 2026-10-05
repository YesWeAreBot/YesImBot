import { expect, it } from "bun:test";
import { WorldStateService } from "../src/services/worldstate/service";
import { Services, TableName } from "../src/shared/constants";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
function fixture(events: any[] = [], states: any[] = []) {
    const tables = new Map<string, any[]>([
        [TableName.SystemEvents, events],
        ["worldstate.bot_mute_state", states],
    ]);
    const ctx: any = {
        bots: [
            { platform: "onebot", selfId: "a" },
            { platform: "onebot", selfId: "b" },
        ],
        emit() {},
        [Services.Logger]: { getLogger: () => logger },
        database: {
            get: async (table: string) => tables.get(table) || [],
            upsert: async (table: string, values: any[], keys: string[]) => {
                const rows = tables.get(table) || [];
                for (const value of values) {
                    const existing = rows.find((row) => keys.every((key) => row[key] === value[key]));
                    // Real JSON persistence turns Infinity into null.
                    const persisted = JSON.parse(JSON.stringify(value));
                    if (existing) Object.assign(existing, persisted);
                    else rows.push(persisted);
                }
                tables.set(table, rows);
            },
        },
    };
    const restart = () => {
        const world: any = Object.create(WorldStateService.prototype);
        Object.defineProperties(world, { ctx: { value: ctx }, logger: { value: logger } });
        Object.assign(world, {
            mutedChannels: new Map(),
            allMutedChannels: new Map(),
            l1_manager: { recordSystemEvent: async () => {} },
            l2_manager: {
                getHistoryGeneration: () => 0,
                writeMemory: async (_target: any, _generation: number, write: Function) => {
                    await write();
                    return true;
                },
            },
        });
        return world;
    };
    return { ctx, tables, restart };
}
const event = (type: string, timestamp: number, user = "a", selfId = "a") => ({
    platform: "onebot",
    channelId: "g",
    type,
    timestamp: new Date(timestamp),
    payload: { details: { user: { id: user }, selfId, duration: 30 * 86400000 } },
});

it("migrates still-active old individual/all mute events and restores after history removal", async () => {
    const old = Date.now() - 8 * 86400000;
    const f = fixture([event("guild-member-ban", old), event("guild-all-member-ban", old, "0", "b")]);
    const world = f.restart();
    await world.initializeMuteStatus();
    expect(world.isBotMuted("onebot:g", "a")).toBe(true);
    expect(world.isBotMuted("onebot:g", "b")).toBe(true);
    f.tables.set(TableName.SystemEvents, []);
    const restarted = f.restart();
    await restarted.initializeMuteStatus();
    expect(restarted.isBotMuted("onebot:g", "a")).toBe(true);
    expect(restarted.isBotMuted("onebot:g", "b")).toBe(true);
    expect(f.tables.get("worldstate.bot_mute_state")!.every((row) => row.expiresAt !== null)).toBe(true);
});

it("persists release tombstones so stale history cannot revive a mute", async () => {
    const f = fixture([event("guild-member-ban", Date.now() - 1000), event("guild-all-member-ban", Date.now() - 1000, "0")]);
    const world = f.restart();
    await world.initializeMuteStatus();
    await world.updateMuteStatus("onebot:g", 0, "a");
    await world.updateMuteStatus("onebot:g", 0, "a", "all");
    await world.recordSystemEvent(event("guild-member-unban", Date.now()));
    const restarted = f.restart();
    await restarted.initializeMuteStatus();
    expect(restarted.isBotMuted("onebot:g", "a")).toBe(false);
});

it("persists current changes without relying on any historical events", async () => {
    const f = fixture();
    const world = f.restart();
    await world.initializeMuteStatus();
    await world.updateMuteStatus("onebot:g", Infinity, "a", "all");
    await world.updateMuteStatus("onebot:private:x", Date.now() + 60000, "b");
    await world.recordSystemEvent(event("guild-all-member-ban", Date.now(), "0"));
    const restarted = f.restart();
    await restarted.initializeMuteStatus();
    expect(restarted.isBotMuted("onebot:g", "a")).toBe(true);
    expect(restarted.isBotMuted("onebot:g", "b")).toBe(false);
    expect(restarted.isBotMuted("onebot:private:x", "b")).toBe(true);
});

it("reports persistence failures and lets the next update recover the queue", async () => {
    const f = fixture([event("guild-member-ban", Date.now() - 1000)]);
    const world = f.restart();
    await world.initializeMuteStatus();
    const upsert = f.ctx.database.upsert;
    let fail = true;
    f.ctx.database.upsert = async (...args: any[]) => {
        if (fail) {
            fail = false;
            throw new Error("disk unavailable");
        }
        return upsert(...args);
    };
    await expect(world.updateMuteStatus("onebot:g", 0, "a")).rejects.toThrow("disk unavailable");
    let recorded = false;
    world.l1_manager.recordSystemEvent = async () => {
        recorded = true;
    };
    await world.recordSystemEvent(event("guild-member-unban", Date.now()));
    expect(recorded).toBe(true);
    await world.updateMuteStatus("onebot:g", 0, "a");
    await world.recordSystemEvent(event("guild-member-unban", Date.now()));
    const restarted = f.restart();
    await restarted.initializeMuteStatus();
    expect(restarted.isBotMuted("onebot:g", "a")).toBe(false);
});

it("waits for the last accepted mute update on service stop", async () => {
    const f = fixture();
    const world = f.restart();
    await world.initializeMuteStatus();
    let release!: () => void;
    const gate = new Promise<void>((done) => {
        release = done;
    });
    const upsert = f.ctx.database.upsert;
    f.ctx.database.upsert = async (...args: any[]) => {
        await gate;
        return upsert(...args);
    };
    world.eventListenerManager = { stop() {} };
    world.l3_manager = { stop: async () => {} };
    world.l2_manager.stop = async () => {};
    world.updateMuteStatus("onebot:g", Infinity, "a", "all");
    let stopped = false;
    const stopping = world.stop().then(() => {
        stopped = true;
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(stopped).toBe(false);
    release();
    await stopping;
    const restarted = f.restart();
    await restarted.initializeMuteStatus();
    expect(restarted.isBotMuted("onebot:g", "a")).toBe(true);
});
