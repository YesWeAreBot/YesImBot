import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import memory from "@koishijs/plugin-database-memory";
import { Context } from "koishi";
import { expect, it, onTestFinished, vi } from "vitest";

import { TableName } from "../src/shared/constants";
import { getInstanceDirectory } from "../src/shared/instance-scope";
import { HISTORY_CHANNELS } from "../src/world/channel-metadata";
import { HistoryCommandManager } from "../src/world/commands";
import { HistoryBackupManager, BACKUP_MAX_BYTES, BACKUP_MAX_ROWS, backupDigest } from "../src/world/history-backup";
import { registerHistoryBackup } from "../src/world/history-backup-commands";
import { InteractionManager } from "../src/world/interaction-manager";
import { SemanticMemoryManager } from "../src/world/l2-semantic-memory";
import { WorldStateService } from "../src/world/service";
import { stubCtx } from "./helpers/yesimbot";

const target = { platform: "qq", channelId: "room", selfId: "bot" };
const log = { info() {}, warn() {}, error() {}, debug() {} };
const message = (id = "m1", content = "原始消息") => ({
    id,
    platform: target.platform,
    channelId: target.channelId,
    sender: { id: "u1" },
    timestamp: new Date("2026-10-01T00:00:00.000Z"),
    content,
});
async function fixture() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yib-backup-"));
    const app = new Context();
    app.plugin(memory);
    (WorldStateService.prototype as any).registerModels.call({ ctx: app });
    await app.start();
    await app.database.prepared();
    await app.database.create(HISTORY_CHANNELS, { platform: target.platform, channelId: target.channelId, channelType: "guild" });
    onTestFinished(async () => {
        await app.stop();
        await fs.rm(dir, { recursive: true, force: true });
    });
    const ctx = stubCtx({ logging: { getLogger: () => log } }, { baseDir: dir, database: app.database, scope: { key: "core:one" } });
    const config: any = { l2_memory: { enabled: false } };
    const l1_manager = new InteractionManager(ctx, config, ctx.yesimbot.logging),
        l2_manager = new SemanticMemoryManager(ctx, config, ctx.yesimbot.logging, ctx.yesimbot.model);
    const world: any = { l1_manager, l2_manager };
    return { app, ctx, world, manager: new HistoryBackupManager(ctx, world), dir };
}
function resign(backup: any) {
    backup.sha256 = backupDigest(backup);
    return backup;
}
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { resolve, promise };
}

it("exports complete channel facts and strict owned logs without configuration or foreign bot events", async () => {
    const f = await fixture();
    await f.app.database.create(TableName.Messages, message());
    await f.app.database.create(TableName.Messages, { ...message("other"), platform: "other" });
    for (const [id, eventScope, botKey] of [
        ["channel", "channel", ""],
        ["own", "channel", JSON.stringify(["qq", "bot"])],
        ["foreign", "channel", JSON.stringify(["qq", "other"])],
        ["global", "global", ""],
        ["mind", "mind", "mind:secret"],
    ]) {
        await f.app.database.create(TableName.SystemEvents, {
            id,
            platform: target.platform,
            channelId: target.channelId,
            eventScope,
            botKey,
            type: "notice",
            payload: {},
            timestamp: new Date(),
        });
    }
    await f.world.l1_manager.recordThought("turn", "qq", "room", { observe: "看到", analyze_infer: "理解", plan: "回复" });
    const file = path.join(getInstanceDirectory(f.ctx, "data/yesimbot/interactions"), "qq", "room.agent.jsonl");
    await fs.appendFile(file, JSON.stringify({ type: "agent_thought", id: "legacy", turnId: "old", timestamp: new Date().toISOString() }) + "\n{broken\n");
    const backup = await f.manager.export(target);
    expect(backup.version).toBe(1);
    expect(backup.scope.instance).toMatch(/^[0-9a-f]{24}$/);
    expect(backup.databaseScope).toBe("shared-platform-channel");
    expect(backup.records.messages.map((row: any) => row.id)).toEqual(["m1"]);
    expect(backup.records.events.map((row: any) => row.id).sort()).toEqual(["channel", "own"]);
    expect(backup.agentLogs.records).toHaveLength(1);
    expect(backup.agentLogs.unknown).toBe(1);
    expect(backup.agentLogs.malformed).toBe(1);
    expect(backup.agentLogs.restore).toBe("unsupported");
    expect(Object.keys(backup.records).sort()).toEqual(["events", "l2", "l3", "messages"]);
    expect(backup.sha256).toBe(backupDigest(backup));
    expect(backup.sha256).toMatch(/^[0-9a-f]{64}$/);
});

it("round trips the four tables incrementally and repeated import is idempotent", async () => {
    const f = await fixture();
    await f.app.database.create(TableName.Messages, message());
    await f.app.database.create(TableName.L2Chunks, {
        id: "l2",
        platform: target.platform,
        channelId: target.channelId,
        content: "内容",
        embedding: [1, 0],
        participantIds: ["u1"],
        startTimestamp: new Date(1000),
        endTimestamp: new Date(2000),
    });
    await f.app.database.create(TableName.L3Diaries, {
        id: "l3",
        platform: target.platform,
        channelId: target.channelId,
        date: "2026-10-01",
        content: "日记",
        keywords: ["内容"],
        mentionedUserIds: ["u1"],
        generatedAt: new Date(3000),
        sourceMessageCount: 1,
    });
    await f.app.database.create(TableName.SystemEvents, {
        id: "e1",
        platform: target.platform,
        channelId: target.channelId,
        eventScope: "channel",
        type: "notice",
        payload: { nested: { value: 1 } },
        timestamp: new Date(1000),
    });
    const backup = await f.manager.export(target);
    for (const table of [TableName.Messages, TableName.L2Chunks, TableName.L3Diaries, TableName.SystemEvents])
        await f.app.database.remove(table, { platform: "qq", channelId: "room" });
    const checked = await f.manager.preflight(target, JSON.stringify(backup));
    expect(checked.status).toBe("ready");
    expect(checked.missing).toEqual({ messages: 1, events: 1, l2: 1, l3: 1 });
    const restored = await f.manager.restore(target, JSON.stringify(backup));
    expect(restored.status).toBe("restored");
    expect(restored.inserted).toEqual(checked.missing);
    expect((await f.app.database.get(TableName.Messages, { id: "m1" }))[0].timestamp).toBeInstanceOf(Date);
    expect((await f.manager.restore(target, JSON.stringify(backup))).inserted).toEqual({ messages: 0, events: 0, l2: 0, l3: 0 });
});

it("reports conflicts before inserting anything and never overwrites a newer row", async () => {
    const f = await fixture();
    await f.app.database.create(TableName.Messages, message());
    const backup = await f.manager.export(target);
    backup.records.messages.push({ ...backup.records.messages[0], id: "new" });
    resign(backup);
    await f.app.database.set(TableName.Messages, { id: "m1" }, { content: "较新的消息" });
    const result = await f.manager.restore(target, JSON.stringify(backup));
    expect(result.status).toBe("conflict");
    expect(result.conflicts).toEqual([{ kind: "messages", id: "m1" }]);
    expect(await f.app.database.get(TableName.Messages, { id: "new" })).toEqual([]);
    expect((await f.app.database.get(TableName.Messages, { id: "m1" }))[0].content).toBe("较新的消息");
});

it.each(["instance", "platform", "channelId", "selfId"])("rejects a backup for another %s even when its checksum is valid", async (key) => {
    const f = await fixture();
    const backup = await f.manager.export(target);
    (backup.scope as any)[key] = key === "instance" ? "a".repeat(24) : "other";
    resign(backup);
    await expect(f.manager.restore(target, JSON.stringify(backup))).rejects.toThrow("归属");
});

it("rejects hash damage, unknown versions, excess data and forged row scope", async () => {
    const f = await fixture();
    const backup = await f.manager.export(target);
    await expect(f.manager.preflight(target, JSON.stringify({ ...backup, sha256: "0".repeat(64) }))).rejects.toThrow("完整性");
    await expect(f.manager.preflight(target, JSON.stringify({ ...backup, version: 2 }))).rejects.toThrow("版本");
    await expect(f.manager.preflight(target, " ".repeat(BACKUP_MAX_BYTES + 1))).rejects.toThrow("大小");
    const forged = structuredClone(backup);
    forged.records.messages = [{ ...message(), timestamp: new Date().toISOString(), platform: "other" }];
    await expect(f.manager.restore(target, JSON.stringify(resign(forged)))).rejects.toThrow("范围");
    forged.records.messages = Array.from({ length: BACKUP_MAX_ROWS + 1 }, (_, i) => ({ ...message(String(i)), timestamp: new Date().toISOString() }));
    await expect(f.manager.preflight(target, JSON.stringify(resign(forged)))).rejects.toThrow("条数");
});

it("rejects duplicates inside a package and globally colliding L2 IDs outside the target", async () => {
    const f = await fixture();
    await f.app.database.create(TableName.Messages, message());
    const backup = await f.manager.export(target);
    backup.records.messages.push(backup.records.messages[0]);
    await expect(f.manager.preflight(target, JSON.stringify(resign(backup)))).rejects.toThrow("重复");
    backup.records.messages.pop();
    backup.records.l2.push({
        id: "collision",
        platform: "qq",
        channelId: "room",
        content: "内容",
        embedding: [],
        participantIds: [],
        startTimestamp: new Date(0).toISOString(),
        endTimestamp: new Date(1).toISOString(),
    });
    await f.app.database.create(TableName.L2Chunks, { ...backup.records.l2[0], channelId: "elsewhere" } as any);
    expect((await f.manager.preflight(target, JSON.stringify(resign(backup)))).conflicts).toContainEqual({ kind: "l2", id: "collision" });
});

it("reports partial effects on a failed insert and supports an idempotent retry", async () => {
    const f = await fixture();
    await f.app.database.create(TableName.Messages, message("a"));
    await f.app.database.create(TableName.Messages, message("b"));
    const backup = await f.manager.export(target);
    await f.app.database.remove(TableName.Messages, {});
    const original = f.ctx.database;
    let fail = true;
    const database = new Proxy(original, {
        get(db, key) {
            if (key === Symbol.for("cordis.original")) return db;
            if (key === "create")
                return async (table: any, row: any) => {
                    if (row.id === "b" && fail) throw new Error("disk unavailable");
                    return db.create(table, row);
                };
            const value = Reflect.get(db, key);
            return typeof value === "function" ? value.bind(db) : value;
        },
    });
    const manager = new HistoryBackupManager({ ...f.ctx, database }, f.world);
    const partial = await manager.restore(target, JSON.stringify(backup));
    expect(partial.status).toBe("partial");
    expect(partial.partialEffects).toBe(true);
    expect(partial.inserted.messages).toBe(1);
    fail = false;
    expect((await manager.restore(target, JSON.stringify(backup))).inserted.messages).toBe(1);
    expect(await original.get(TableName.Messages, {})).toHaveLength(2);
});

it("refuses a snapshot if a concurrent history clear changes its generation", async () => {
    const f = await fixture();
    const entered = deferred(),
        release = deferred();
    const database = new Proxy(f.ctx.database, {
        get(db, key) {
            if (key === Symbol.for("cordis.original")) return db;
            if (key === "get")
                return async (table: any, query: any, options: any) => {
                    if (table === TableName.Messages) {
                        entered.resolve();
                        await release.promise;
                    }
                    return db.get(table, query, options);
                };
            const value = Reflect.get(db, key);
            return typeof value === "function" ? value.bind(db) : value;
        },
    });
    const manager = new HistoryBackupManager({ ...f.ctx, database }, f.world);
    const exporting = manager.export(target);
    await entered.promise;
    let cleared = false;
    const clearing = new SemanticMemoryManager(f.ctx, { l2_memory: {} } as any, f.ctx.yesimbot.logging, f.ctx.yesimbot.model).clearHistory(target, async () => {
        cleared = true;
    });
    expect(cleared).toBe(false);
    release.resolve();
    await expect(exporting).rejects.toThrow("历史");
    await clearing;
    expect(cleared).toBe(true);
});

it("only exports Agent logs and explicitly reports they cannot be restored", async () => {
    const f = await fixture();
    await f.world.l1_manager.recordThought("turn", "qq", "room", { observe: "o", analyze_infer: "a", plan: "p" });
    const backup = await f.manager.export(target);
    await f.world.l1_manager.clearAgentHistory("qq", "room");
    const result = await f.manager.restore(target, JSON.stringify(backup));
    expect(result.agentLogs).toEqual({ exported: 1, restored: 0, restore: "unsupported" });
    expect(await f.world.l1_manager.getAgentHistoryForDateRange("qq", "room", new Date(0), new Date())).toEqual([]);
});

it("saves restricted files and reloads only local backup IDs", async () => {
    const f = await fixture();
    await f.app.database.create(TableName.Messages, message());
    const saved = await f.manager.save(target);
    const input = await f.manager.load(saved.id);
    expect((await f.manager.preflight(target, input)).identical.messages).toBe(1);
    expect(process.platform === "win32" ? 0o600 : (await fs.stat(saved.filePath)).mode & 0o777).toBe(0o600);
    await expect(f.manager.load("../config")).rejects.toThrow("编号");
});

it("restores the newest current-target backup when the command omits its ID", async () => {
    const f = await fixture();
    const directory = getInstanceDirectory(f.ctx, "data/yesimbot/backups");
    await fs.mkdir(directory, { recursive: true });
    const backup = await f.manager.export(target);
    const write = async (id: string, createdAt: string, scope = backup.scope, content = id) => {
        const value = structuredClone(backup);
        value.createdAt = createdAt;
        value.scope = scope;
        value.records.messages = [{ ...message(id, content), timestamp: new Date().toISOString() }];
        await fs.writeFile(path.join(directory, `${id}.json`), JSON.stringify(resign(value)));
    };
    const older = "00000000-0000-4000-8000-000000000001";
    const newest = "00000000-0000-4000-8000-000000000002";
    // Deliberately write the oldest last: selection must use manifest time, not file mtime.
    await write(newest, "2026-10-02T00:00:00.000Z");
    for (const [index, key] of ["platform", "channelId", "selfId", "instance"].entries())
        await write(`00000000-0000-4000-8000-00000000001${index}`, "2026-10-03T00:00:00.000Z", { ...backup.scope, [key]: "other" });
    await write(older, "2026-10-01T00:00:00.000Z");
    await fs.writeFile(path.join(directory, "00000000-0000-4000-8000-000000000099.json"), "{broken");
    const actions = new Map<string, Function>();
    const command: any = {
        subcommand(name: string) {
            const cmd: any = { usage: () => cmd, action: (action: Function) => actions.set(name, action) };
            return cmd;
        },
    };
    f.ctx.filter = () => true;
    f.world.isChannelAllowed = () => true;
    registerHistoryBackup(f.ctx, command, f.world);
    const result = await actions.get(".backup.restore [id:string]")!({ session: target });
    expect(String(result)).toContain("四表增量恢复完成");
    expect(String(result)).toContain(`备份 ${newest}`);
    expect((await f.app.database.get(TableName.Messages, {})).map((row) => row.id)).toEqual([newest]);
    await f.app.database.remove(TableName.Messages, {});
    const explicit = await actions.get(".backup.restore [id:string]")!({ session: target }, older);
    expect(String(explicit)).toContain("四表增量恢复完成");
    expect(String(explicit)).toContain(`备份 ${older}`);
    expect((await f.app.database.get(TableName.Messages, {})).map((row) => row.id)).toEqual([older]);
    const foreign = await actions.get(".backup.restore [id:string]")!({ session: target }, "00000000-0000-4000-8000-000000000010");
    expect(String(foreign)).toContain("归属");
    expect((await f.app.database.get(TableName.Messages, {})).map((row) => row.id)).toEqual([older]);
});

it("finds no latest backup when only another channel has backups", async () => {
    const f = await fixture();
    await f.manager.save({ ...target, channelId: "other" });
    expect(await f.manager.loadLatest(target)).toBeUndefined();
});

it("removes temporary files after a save write failure", async () => {
    const f = await fixture();
    const open = fs.open.bind(fs);
    const spy = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        const handle = await open(...args);
        if (String(args[0]).endsWith(".tmp"))
            handle.writeFile = async () => {
                throw new Error("disk full");
            };
        return handle;
    });
    try {
        await expect(f.manager.save(target)).rejects.toThrow("disk full");
    } finally {
        spy.mockRestore();
    }
    expect(await fs.readdir(getInstanceDirectory(f.ctx, "data/yesimbot/backups"))).toEqual([]);
});

it("restoration waits for accepted writes and blocks a second-instance clear until inserts finish", async () => {
    const f = await fixture();
    await f.app.database.create(TableName.Messages, message());
    const backup = await f.manager.export(target);
    await f.app.database.remove(TableName.Messages, {});
    const inserted = deferred(),
        release = deferred();
    const database = new Proxy(f.ctx.database, {
        get(db, key) {
            if (key === Symbol.for("cordis.original")) return db;
            if (key === "create")
                return async (table: any, row: any) => {
                    inserted.resolve();
                    await release.promise;
                    return db.create(table, row);
                };
            const value = Reflect.get(db, key);
            return typeof value === "function" ? value.bind(db) : value;
        },
    });
    const manager = new HistoryBackupManager({ ...f.ctx, database }, f.world);
    const restore = manager.restore(target, JSON.stringify(backup));
    await inserted.promise;
    let cleared = false;
    const clearing = new SemanticMemoryManager(f.ctx, { l2_memory: {} } as any, f.ctx.yesimbot.logging, f.ctx.yesimbot.model).clearHistory(target, async () => {
        cleared = true;
    });
    expect(cleared).toBe(false);
    release.resolve();
    expect((await restore).status).toBe("restored");
    await clearing;
    expect(cleared).toBe(true);
});

it("does not invalidate live history for an entirely identical repeated import", async () => {
    const f = await fixture();
    await f.app.database.create(TableName.Messages, message());
    const backup = await f.manager.export(target);
    const generation = f.world.l2_manager.getHistoryGeneration(target);
    expect((await f.manager.restore(target, JSON.stringify(backup))).status).toBe("restored");
    expect(f.world.l2_manager.getHistoryGeneration(target)).toBe(generation);
});

it("coordinates retention deletion with an active backup snapshot", async () => {
    const f = await fixture();
    await f.app.database.create(TableName.Messages, message());
    const entered = deferred(),
        release = deferred();
    const database = new Proxy(f.ctx.database, {
        get(db, key) {
            if (key === Symbol.for("cordis.original")) return db;
            if (key === "get")
                return async (table: any, query: any, options: any) => {
                    if (table === TableName.Messages) {
                        entered.resolve();
                        await release.promise;
                    }
                    return db.get(table, query, options);
                };
            const value = Reflect.get(db, key);
            return typeof value === "function" ? value.bind(db) : value;
        },
    });
    const manager = new HistoryBackupManager({ ...f.ctx, database }, f.world);
    const exporting = manager.export(target);
    await entered.promise;
    const cleaning = (WorldStateService.prototype as any).clear.call({
        ctx: f.ctx,
        config: { dataRetentionDays: 0 },
        logger: log,
        l2_manager: f.world.l2_manager,
        l1_manager: { pruneOldData: async () => {} },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(await f.app.database.get(TableName.Messages, {})).toHaveLength(1);
    release.resolve();
    expect((await exporting).records.messages).toHaveLength(1);
    await cleaning;
    expect(await f.app.database.get(TableName.Messages, {})).toEqual([]);
});

it("never copies extra caller scope fields into the manifest", async () => {
    const f = await fixture();
    const backup = await f.manager.export({ ...target, apiKey: "do-not-copy" } as any);
    expect(Object.keys(backup.scope).sort()).toEqual(["channelId", "channelType", "instance", "platform", "selfId"]);
    expect(JSON.stringify(backup)).not.toContain("do-not-copy");
});

it.skipIf(process.platform === "win32")("rejects a symbolic link supplied as a backup file", async () => {
    const f = await fixture();
    const saved = await f.manager.save(target);
    await fs.symlink(saved.filePath, path.join(path.dirname(saved.filePath), "00000000-0000-4000-8000-000000000000.json"));
    await expect(f.manager.load("00000000-0000-4000-8000-000000000000")).rejects.toThrow(/ELOOP|symbolic|link/i);
});

it("stops paged export before later rows or tables when the byte budget is exhausted", async () => {
    const f = await fixture();
    const large = "x".repeat(BACKUP_MAX_BYTES / 2);
    const rows = [
        message("a", large),
        message("b", large),
        {
            ...message("c"),
            get content() {
                throw new Error("later row touched");
            },
        },
    ];
    const reads: Array<{ table: string; limit: number }> = [];
    const database = new Proxy(f.ctx.database, {
        get(db, key) {
            if (key === Symbol.for("cordis.original")) return db;
            if (key === "get")
                return async (table: any, query: any, options: any) => {
                    reads.push({ table, limit: options?.limit });
                    if (table === TableName.Messages) return rows.slice(options?.offset ?? 0, (options?.offset ?? 0) + options.limit);
                    return db.get(table, query, options);
                };
            const value = Reflect.get(db, key);
            return typeof value === "function" ? value.bind(db) : value;
        },
    });
    const manager = new HistoryBackupManager({ ...f.ctx, database }, f.world);
    await expect(manager.export(target)).rejects.toThrow("大小");
    expect(reads.filter((read) => read.table === TableName.Messages)).toHaveLength(2);
    expect(reads.filter((read) => read.table === TableName.Messages).every((read) => read.limit === 1)).toBe(true);
    expect(reads.some((read) => read.table === TableName.L2Chunks || read.table === TableName.L3Diaries || read.table === TableName.SystemEvents)).toBe(false);
});

it("rebuilds known channel type metadata so typed history clearing covers restored facts", async () => {
    const f = await fixture();
    await f.app.database.create(TableName.Messages, { ...message(), channelType: "guild" });
    const backup = await f.manager.export(target);
    await f.app.database.remove(TableName.Messages, {});
    await f.app.database.remove(HISTORY_CHANNELS, { platform: "qq", channelId: "room" });
    expect((await f.manager.restore(target, JSON.stringify(backup))).status).toBe("restored");
    expect(await f.app.database.get(HISTORY_CHANNELS, { platform: "qq", channelId: "room" })).toMatchObject([{ channelType: "guild" }]);
    const query = await (HistoryCommandManager.prototype as any).typedChannelQuery.call({ ctx: f.ctx }, "guild");
    expect((await f.app.database.remove(TableName.Messages, query)).removed).toBe(1);
});

it("refuses to infer missing channel type metadata for an L2-only legacy package", async () => {
    const f = await fixture();
    await f.app.database.remove(HISTORY_CHANNELS, {});
    await f.app.database.create(TableName.L2Chunks, {
        id: "l2only",
        platform: "qq",
        channelId: "room",
        content: "内容",
        embedding: [],
        participantIds: [],
        startTimestamp: new Date(0),
        endTimestamp: new Date(1),
    });
    const backup = await f.manager.export(target);
    await f.app.database.remove(TableName.L2Chunks, {});
    const result = await f.manager.restore(target, JSON.stringify(backup));
    expect(result.status).toBe("conflict");
    expect(result.metadata.reason).toContain("不会自动猜测");
    expect(result.conflicts).toContainEqual({ kind: "channelMetadata", id: "room" });
    expect(await f.app.database.get(TableName.L2Chunks, {})).toEqual([]);
});

it("uses actual database paging to export every row exactly once", async () => {
    const f = await fixture();
    for (let i = 0; i < 7; i++) await f.app.database.create(TableName.Messages, message(`m${i}`, `完整正文${i}`));
    const backup = await f.manager.export(target);
    expect(backup.records.messages.map((row) => row.id)).toEqual(["m0", "m1", "m2", "m3", "m4", "m5", "m6"]);
    expect(backup.records.messages.map((row) => row.content)).toEqual(Array.from({ length: 7 }, (_, i) => `完整正文${i}`));
});
