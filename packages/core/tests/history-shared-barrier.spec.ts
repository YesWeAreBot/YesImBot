import { expect, it } from "vitest";

import { SemanticMemoryManager } from "../src/services/worldstate/l2-semantic-memory";
import { Services } from "../src/shared/constants";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function fixture() {
    const rows: any[] = [];
    const database = {
        create: async (_table: string, row: any) => {
            rows.push(row);
            return row;
        },
    };
    const config: any = { l2_memory: { enabled: true, messagesPerChunk: 2 } };
    const log = { info() {}, warn() {}, error() {}, debug() {} };
    const ctx: any = {
        database,
        [Services.Logger]: { getLogger: () => log },
        [Services.Model]: { useEmbeddingGroup: () => ({ getModels: () => [{ embed: async () => ({ embedding: [1] }) }] }) },
    };
    const a = new SemanticMemoryManager(ctx, config),
        b = new SemanticMemoryManager(ctx, config);
    a.start();
    b.start();
    return { a, b, rows };
}
const target = { platform: "qq", channelId: "room" };
it("invalidates another manager's in-flight work on the same database", async () => {
    const f = fixture();
    const before = f.b.getHistoryGeneration(target);
    await f.a.clearHistory(target, async () => {});
    expect(
        await f.b.writeMemory(target, before, async () => {
            f.rows.push("stale");
        }),
    ).toBe(false);
    expect(f.rows).toEqual([]);
});
it("waits for another manager's issued write before deleting", async () => {
    const f = fixture(),
        release = deferred();
    const writing = f.b.writeMemory(target, f.b.getHistoryGeneration(target), async () => {
        await release.promise;
        f.rows.push("old");
    });
    let deleted = false;
    const clearing = f.a.clearHistory(target, async () => {
        deleted = true;
        f.rows.length = 0;
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const deletedBeforeWriteFinished = deleted;
    release.resolve();
    await Promise.all([writing, clearing]);
    expect(deletedBeforeWriteFinished).toBe(false);
    expect(f.rows).toEqual([]);
});
it("discards another manager's unflushed pre-clear buffer", async () => {
    const f = fixture();
    await f.b.addMessageToBuffer({ ...target, id: "old", content: "old secret", timestamp: new Date(), sender: { id: "u", name: "U" } });
    await f.a.clearHistory(target, async () => {});
    await f.b.stop();
    expect(f.rows).toEqual([]);
});
it("keeps independent databases isolated", async () => {
    const left = fixture(),
        right = fixture();
    const before = right.a.getHistoryGeneration(target);
    await left.a.clearHistory(target, async () => {});
    expect(right.a.getHistoryGeneration(target)).toBe(before);
});
