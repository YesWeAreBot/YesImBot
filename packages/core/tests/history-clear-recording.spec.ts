import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { HISTORY_CHANNELS } from "../src/services/worldstate/channel-metadata";
import { HistoryCommandManager } from "../src/services/worldstate/commands";
import { InteractionManager } from "../src/services/worldstate/interaction-manager";
import { SemanticMemoryManager } from "../src/services/worldstate/l2-semantic-memory";
import { WorldStateService } from "../src/services/worldstate/service";
import { Services, TableName } from "../src/shared/constants";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
const log = { info() {}, debug() {}, warn() {}, error() {} };
function matches(row: any, query: any): boolean {
    if (query.$or) return query.$or.some((candidate: unknown) => matches(row, candidate));
    return Object.entries(query).every(([key, value]: [string, any]) => {
        if (value?.$regex) return value.$regex.test(row[key]);
        if (value?.$not) return !value.$not.$regex.test(row[key]);
        if (value?.$in) return value.$in.includes(row[key]);
        return row[key] === value;
    });
}
for (const overlap of [false, true]) {
    for (const commitFirst of [true, false]) {
        for (const type of [undefined, "private", "guild", "all"]) {
            it(`clears accepted L1 writes before ${commitFirst ? "return" : "commit"} for ${type ?? "target"}, preserving later messages${overlap ? " across overlapping clears" : ""}`, async () => {
                const root = await fs.mkdtemp(path.join(os.tmpdir(), "yib-clear-recording-"));
                try {
                    const rows = new Map<string, any[]>(
                        [TableName.Messages, TableName.SystemEvents, TableName.L2Chunks, TableName.L3Diaries].map((name) => [name, []]),
                    );
                    // -a private/guild 依赖 HISTORY_CHANNELS 判定频道类型。
                    rows.set(HISTORY_CHANNELS, [
                        { platform: "onebot", channelId: "private:user", channelType: "private" },
                        { platform: "onebot", channelId: "same", channelType: "guild" },
                    ]);
                    const entered = deferred(),
                        release = deferred();
                    const actions = new Map<string, Function>();
                    const command = (name: string): any => {
                        const cmd = {
                            option: () => cmd,
                            usage: () => cmd,
                            example: () => cmd,
                            subcommand: (suffix: string) => command(name + suffix),
                            action: (fn: Function) => {
                                actions.set(name, fn);
                                return cmd;
                            },
                        };
                        return cmd;
                    };
                    const ctx: any = {
                        baseDir: root,
                        logger: log,
                        command,
                        [Services.Logger]: { getLogger: () => log },
                        [Services.Model]: { useEmbeddingGroup: () => ({ getModels: () => [{ embed: async () => ({ embedding: [1] }) }] }) },
                        database: {
                            get: async (table: string, query: any) => rows.get(table)!.filter((row) => matches(row, query)),
                            create: async (table: string, row: any) => {
                                if (row.id === "old") {
                                    if (commitFirst) rows.get(table)!.push(row);
                                    entered.resolve();
                                    await release.promise;
                                    if (!commitFirst) rows.get(table)!.push(row);
                                } else rows.get(table)!.push(row);
                                return row;
                            },
                            remove: async (table: string, query: any) => {
                                const old = rows.get(table)!;
                                const keep = old.filter((row) => !matches(row, query));
                                rows.set(table, keep);
                                return { removed: old.length - keep.length };
                            },
                        },
                    };
                    const config: any = { l2_memory: { enabled: true, messagesPerChunk: 1 }, l1_memory: { maxMessages: 10 } };
                    const world: any = Object.create(WorldStateService.prototype);
                    world.config = config;
                    world.l1_manager = new InteractionManager(ctx, config);
                    world.l2_manager = new SemanticMemoryManager(ctx, config);
                    world.l2_manager.observeChannel({ platform: "onebot", channelId: "private:user" }, "private");
                    world.l2_manager.observeChannel({ platform: "onebot", channelId: "same" }, "guild");
                    world.l2_manager.start();
                    new HistoryCommandManager(ctx, world, config).register();
                    const channelId = type === "private" ? "private:user" : "same";
                    const message = (id: string, platform = "onebot") => ({
                        id,
                        platform,
                        channelId,
                        content: id,
                        sender: { id: "user", name: "User" },
                        timestamp: new Date(1000),
                    });
                    const old = world.recordMessage(message("old"));
                    await entered.promise;
                    let cleared = false;
                    const clearing = actions.get("history.clear")!({
                        session: { platform: "onebot", channelId },
                        options: type ? { all: type } : {},
                    }).then((value: string) => {
                        cleared = true;
                        return value;
                    });
                    const fresh = world.recordMessage(message("fresh"));
                    const secondClear = overlap
                        ? actions.get("history.clear")!({ session: { platform: "onebot", channelId }, options: { all: "all" } })
                        : undefined;
                    const newest = overlap ? world.recordMessage(message("newest")) : undefined;
                    // An explicit target must not hold another platform's L1 write.
                    const other = !type && !overlap ? world.recordMessage(message("other", "discord")) : undefined;
                    if (other) await other;
                    for (let i = 0; i < 25; i++) await Promise.resolve();
                    const completedEarly = cleared;
                    release.resolve();
                    const report = await clearing;
                    await Promise.all([old, fresh, secondClear, newest]);
                    await world.l2_manager.stop();
                    expect(completedEarly).toBe(false);
                    expect(report).toContain("操作成功");
                    const wanted = overlap ? ["newest"] : !type ? ["fresh", "other"] : ["fresh"];
                    expect(
                        rows
                            .get(TableName.Messages)!
                            .map((row) => row.id)
                            .sort(),
                    ).toEqual(wanted);
                    expect(
                        rows
                            .get(TableName.L2Chunks)!
                            .map((row) => row.content)
                            .sort(),
                    ).toEqual(wanted.map((id) => `User: ${id}`));
                } finally {
                    // Windows 下 antivirus/索引器会短暂锁住新目录，EBUSY 时稍候重试。
                    for (let attempt = 0; ; attempt++) {
                        try {
                            await fs.rm(root, { recursive: true, force: true });
                            break;
                        } catch (error) {
                            const code = (error as NodeJS.ErrnoException).code;
                            // Windows 下杀毒/索引进程会短暂锁住刚写入的目录，
                            // EBUSY/ENOTEMPTY 均为瞬时状态，稍候重试即可。
                            if (attempt >= 5 || (code !== "EBUSY" && code !== "ENOTEMPTY")) throw error;
                            const { promise, resolve } = Promise.withResolvers<void>();
                            setTimeout(resolve, 50 * (attempt + 1));
                            await promise;
                        }
                    }
                }
            });
        }
    }
}
