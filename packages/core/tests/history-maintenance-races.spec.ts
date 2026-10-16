import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import memory from "@koishijs/plugin-database-memory";
import { Context } from "koishi";
import { expect, it, onTestFinished } from "vitest";

import { TableName } from "../src/shared/constants";
import { HISTORY_CHANNELS } from "../src/world/channel-metadata";
import { HistoryBackupManager } from "../src/world/history-backup";
import { InteractionManager } from "../src/world/interaction-manager";
import { SemanticMemoryManager } from "../src/world/l2-semantic-memory";
import { WorldStateService } from "../src/world/service";
import { stubCtx } from "./helpers/yesimbot";
const target = { platform: "qq", channelId: "room", selfId: "bot", channelType: "guild" as const };
const log = { info() {}, warn() {}, error() {}, debug() {} };
const msg = (id: string) => ({
    platform: "qq",
    channelId: "room",
    channelType: "guild" as const,
    id,
    content: "old secret " + id,
    sender: { id: "user" },
    timestamp: new Date("2020-01-01"),
});
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { resolve, promise };
}
async function fixture(embed: (content: string) => Promise<{ embedding: number[] }> = async () => ({ embedding: [1] })) {
    const app = new Context();
    app.plugin(memory);
    (WorldStateService.prototype as any).registerModels.call({ ctx: app });
    await app.start();
    await app.database.prepared();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "audit-history-"));
    onTestFinished(async () => {
        await app.stop();
        await fs.rm(root, { recursive: true, force: true });
    });
    await app.database.create(HISTORY_CHANNELS, { platform: "qq", channelId: "room", channelType: "guild" });
    const ctx = stubCtx(
        { logging: { getLogger: () => log }, model: { useEmbeddingGroup: () => ({ getModels: () => [{ embed }] }) } },
        { database: app.database, baseDir: root, scope: { key: "audit" } },
    );
    const config: any = { l2_memory: { enabled: true, messagesPerChunk: 2 }, dataRetentionDays: 1 };
    const l1_manager = new InteractionManager(ctx, config, ctx.yesimbot.logging);
    const l2_manager = new SemanticMemoryManager(ctx, config, ctx.yesimbot.logging, ctx.yesimbot.model);
    l2_manager.start();
    return { app, ctx, config, l1_manager, l2_manager };
}
it("retention rejects an expired batch whose embedding completes after cleanup", async () => {
    const hold = deferred(),
        entered = deferred();
    const f = await fixture(async () => {
        entered.resolve();
        await hold.promise;
        return { embedding: [1] };
    });
    await f.l2_manager.addMessageToBuffer(msg("a"));
    const indexing = f.l2_manager.addMessageToBuffer(msg("b"));
    await entered.promise;
    await (WorldStateService.prototype as any).clear.call({ ctx: f.ctx, config: f.config, l2_manager: f.l2_manager, l1_manager: f.l1_manager, logger: log });
    expect(await f.app.database.get(TableName.L2Chunks, {})).toHaveLength(0);
    hold.resolve();
    await indexing;
    const rows = await f.app.database.get(TableName.L2Chunks, {});
    expect(rows).toHaveLength(0);
});
it("additive restore preserves current buffered messages for later indexing", async () => {
    const f = await fixture();
    const manager = new HistoryBackupManager(f.ctx, f);
    await f.app.database.create(TableName.Messages, msg("backed"));
    const backup = await manager.export(target);
    await f.app.database.remove(TableName.Messages, { id: "backed" });
    const fresh = { ...msg("fresh"), timestamp: new Date() };
    await f.app.database.create(TableName.Messages, fresh);
    await f.l2_manager.addMessageToBuffer(fresh);
    const restored = await manager.restore(target, JSON.stringify(backup));
    await f.l2_manager.stop();
    const messages = await f.app.database.get(TableName.Messages, {}),
        chunks = await f.app.database.get(TableName.L2Chunks, {});

    expect(restored.status).toBe("restored");
    expect(messages).toHaveLength(2);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("fresh");
});

it("retention trims shared buffers without dropping unexpired messages", async () => {
    const f = await fixture();
    const other = new SemanticMemoryManager(f.ctx, f.config, f.ctx.yesimbot.logging, f.ctx.yesimbot.model);
    other.start();
    await other.addMessageToBuffer(msg("expired"));
    await (WorldStateService.prototype as any).clear.call({ ctx: f.ctx, config: f.config, l2_manager: f.l2_manager, l1_manager: f.l1_manager, logger: log });
    const fresh = { ...msg("fresh"), timestamp: new Date() };
    await other.addMessageToBuffer(fresh);
    await other.stop();
    const chunks = await f.app.database.get(TableName.L2Chunks, {});
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("fresh");
    expect(chunks[0].content).not.toContain("expired");
});
it("retention reembeds only the valid portion of an in-flight mixed batch", async () => {
    const hold = deferred(),
        entered = deferred();
    const embedded: string[] = [];
    const f = await fixture(async (content: string) => {
        embedded.push(content);
        if (embedded.length === 1) {
            entered.resolve();
            await hold.promise;
        }
        return { embedding: [embedded.length] };
    });
    await f.l2_manager.addMessageToBuffer(msg("expired"));
    const fresh = { ...msg("fresh"), timestamp: new Date() };
    const indexing = f.l2_manager.addMessageToBuffer(fresh);
    await entered.promise;
    await (WorldStateService.prototype as any).clear.call({ ctx: f.ctx, config: f.config, l2_manager: f.l2_manager, l1_manager: f.l1_manager, logger: log });
    hold.resolve();
    await indexing;
    const chunks = await f.app.database.get(TableName.L2Chunks, {});
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("fresh");
    expect(chunks[0].content).not.toContain("expired");
    expect(embedded).toHaveLength(2);
    expect(chunks[0].embedding.map(Number)).toEqual([2]);
});
it("additive restore preserves an embedding already in flight", async () => {
    const hold = deferred(),
        entered = deferred();
    const f = await fixture(async () => {
        entered.resolve();
        await hold.promise;
        return { embedding: [1] };
    });
    const manager = new HistoryBackupManager(f.ctx, f);
    await f.app.database.create(TableName.Messages, msg("backed"));
    const backup = await manager.export(target);
    await f.app.database.remove(TableName.Messages, { id: "backed" });
    await f.l2_manager.addMessageToBuffer({ ...msg("fresh-a"), timestamp: new Date() });
    const indexing = f.l2_manager.addMessageToBuffer({ ...msg("fresh-b"), timestamp: new Date() });
    await entered.promise;
    const restored = await manager.restore(target, JSON.stringify(backup));
    hold.resolve();
    await indexing;
    const chunks = await f.app.database.get(TableName.L2Chunks, {});
    expect(restored.status).toBe("restored");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("fresh-a");
    expect(chunks[0].content).toContain("fresh-b");
});
