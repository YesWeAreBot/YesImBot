import { expect, it } from "vitest";

import { SemanticMemoryManager } from "../src/services/worldstate/l2-semantic-memory";
import type { MemoryChunkData, MessageData } from "../src/services/worldstate/types";
import { Services } from "../src/shared/constants";

const defaultEmbed = async (_text: string) => ({ embedding: [1, 0] });
const noop = async () => {};

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function chunk(id: string, time: number, content: string, hit = false, platform = "onebot", channelId = "same"): MemoryChunkData {
    return {
        id,
        platform,
        channelId,
        content,
        embedding: hit ? [1, 0] : [0, 1],
        participantIds: [id],
        startTimestamp: new Date(time),
        endTimestamp: new Date(time + 1),
    };
}
function message(content: string): MessageData {
    return { id: content, platform: "onebot", channelId: "same", content, sender: { id: "user", name: "User" }, timestamp: new Date(1000) };
}
function fixture(chunks: MemoryChunkData[] = [], options: Record<string, unknown> = {}) {
    const written: MemoryChunkData[] = [];
    let embed = defaultEmbed;
    let create = async (row: MemoryChunkData) => {
        written.push(row);
    };
    let beforeGet = noop;
    let beforeSet = noop;
    const log = { info() {}, debug() {}, warn() {}, error() {} };
    const ctx: any = {
        [Services.Logger]: { getLogger: () => log },
        [Services.Model]: { useEmbeddingGroup: () => ({ getModels: () => [{ embed: (text: string) => embed(text) }] }) },
        database: {
            get: async (_table: string, query: any) => {
                const result = chunks.filter(
                    (row) =>
                        (!query.platform || typeof query.platform !== "string" || row.platform === query.platform) &&
                        (!query.channelId || typeof query.channelId !== "string" || row.channelId === query.channelId) &&
                        (!query.startTimestamp || row.startTimestamp >= query.startTimestamp.$gte) &&
                        (!query.endTimestamp || row.endTimestamp <= query.endTimestamp.$lte),
                );
                await beforeGet();
                return result;
            },
            create: async (_table: string, row: MemoryChunkData) => {
                await create(row);
                return row;
            },
            set: async (_table: string, query: any, value: any) => {
                await beforeSet();
                chunks.filter((row) => row.id === query.id).forEach((row) => Object.assign(row, value));
            },
        },
    };
    const memory = new SemanticMemoryManager(ctx, {
        l2_memory: { enabled: true, messagesPerChunk: 2, retrievalMinSimilarity: 0.5, includeNeighborChunks: true, ...options },
    } as any);
    memory.start();
    return {
        memory,
        written,
        embedding: (fn: typeof embed) => {
            embed = fn;
        },
        creating: (fn: typeof create) => {
            create = fn;
        },
        reading: (fn: typeof beforeGet) => {
            beforeGet = fn;
        },
        setting: (fn: typeof beforeSet) => {
            beforeSet = fn;
        },
    };
}

for (const filter of [{}, { platform: "onebot" }, { channelId: "same" }]) {
    it(`expands neighbors only within each conversation (${JSON.stringify(filter)})`, async () => {
        const f = fixture([
            chunk("before", 1, "before-1\nbefore-2"),
            chunk("other-room", 2, "wrong room", false, "onebot", "other"),
            chunk("hit", 3, "matched-1\nmatched-2", true),
            chunk("other-platform", 4, "wrong platform", false, "discord"),
            chunk("after", 5, "after-1\nafter-2"),
        ]);
        const result = await f.memory.search("matched", { ...filter, k: 1 });
        expect(result.map((row) => row.content)).toEqual(["before-2\nmatched-1\nmatched-2\nafter-1"]);
        expect(result[0].participantIds).toEqual(["before", "hit", "after"]);
    });
}
it("does not expand neighbors when disabled", async () => {
    const f = fixture([chunk("before", 1, "before"), chunk("hit", 2, "matched", true), chunk("after", 3, "after")], {
        includeNeighborChunks: false,
    });
    expect((await f.memory.search("matched", { k: 1 })).map((row) => row.content)).toEqual(["matched"]);
});
it("merges selected blocks separately when conversations interleave", async () => {
    const f = fixture(
        [
            chunk("a-first", 1, "A1\nA2", true),
            chunk("b-first", 2, "B1\nB2", true, "discord"),
            chunk("a-last", 3, "A3\nA4", true),
            chunk("b-last", 4, "B3\nB4", true, "discord"),
        ],
        { includeNeighborChunks: false },
    );
    const result = await f.memory.search("matched", { k: 4 });
    expect(result.map((row) => [row.platform, row.content, row.participantIds])).toEqual([
        ["onebot", "A1\nA2\nA3\nA4", ["a-first", "a-last"]],
        ["discord", "B1\nB2\nB3\nB4", ["b-first", "b-last"]],
    ]);
});
for (const firstIsHit of [true, false]) {
    it(`preserves a matched edge block in full (${firstIsHit ? "first" : "last"})`, async () => {
        const f = fixture([chunk("first", 1, "first-1\nfirst-2", firstIsHit), chunk("last", 2, "last-1\nlast-2", !firstIsHit)]);
        const result = await f.memory.search("matched", { k: 1 });
        expect(result[0].content).toBe(firstIsHit ? "first-1\nfirst-2\nlast-1" : "first-2\nlast-1\nlast-2");
        expect(result[0].participantIds).toEqual(["first", "last"]);
    });
}
it("preserves all selected blocks including both merged edges", async () => {
    const f = fixture([chunk("first", 1, "first-1\nfirst-2", true), chunk("last", 2, "last-1\nlast-2", true)]);
    expect((await f.memory.search("matched", { k: 2 }))[0].content).toBe("first-1\nfirst-2\nlast-1\nlast-2");
});
for (const k of [0, -1]) {
    it(`returns no results without an embedding request for k=${k}`, async () => {
        const f = fixture([chunk("hit", 1, "matched", true)]);
        let requests = 0;
        f.embedding(async () => {
            requests++;
            return { embedding: [1, 0] };
        });
        expect(await f.memory.search("matched", { k })).toEqual([]);
        expect(requests).toBe(0);
    });
}
it("awaits buffered and already extracted batches before stop completes", async () => {
    const f = fixture(),
        entered = deferred(),
        oldEmbedding = deferred<{ embedding: number[] }>(),
        bufferedEmbedding = deferred<{ embedding: number[] }>();
    f.embedding(async (text) => {
        if (text.includes("old-1")) {
            entered.resolve();
            return oldEmbedding.promise;
        }
        return bufferedEmbedding.promise;
    });
    await f.memory.addMessageToBuffer(message("old-1"));
    const oldBatch = f.memory.addMessageToBuffer(message("old-2"));
    await entered.promise;
    await f.memory.addMessageToBuffer(message("buffered"));
    const stopping = f.memory.stop();
    expect(stopping).toBeInstanceOf(Promise);
    let stopped = false;
    const observedStop = Promise.resolve(stopping).then(() => {
        stopped = true;
    });
    bufferedEmbedding.resolve({ embedding: [1, 0] });
    await Promise.resolve();
    await Promise.resolve();
    expect(stopped).toBe(false);
    oldEmbedding.resolve({ embedding: [1, 0] });
    await Promise.all([oldBatch, observedStop]);
    expect(f.written.map((row) => row.content).sort()).toEqual(["User: buffered", "User: old-1\nUser: old-2"]);
    await f.memory.addMessageToBuffer(message("after-stop"));
    await f.memory.flushBuffer("same");
    expect(f.written).toHaveLength(2);
});
it("awaits an already issued batch database write during stop", async () => {
    const f = fixture([], { messagesPerChunk: 1 }),
        entered = deferred(),
        writing = deferred();
    f.creating(async (row) => {
        entered.resolve();
        await writing.promise;
        f.written.push(row);
    });
    const batch = f.memory.addMessageToBuffer(message("writing"));
    await entered.promise;
    let stopped = false;
    const stopping = Promise.resolve(f.memory.stop()).then(() => {
        stopped = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(stopped).toBe(false);
    writing.resolve();
    await Promise.all([batch, stopping]);
    expect(f.written[0].content).toBe("User: writing");
});
it("shares clear generations and write barriers with external memory writers", async () => {
    const f = fixture(),
        target = { platform: "onebot", channelId: "same" },
        clearing = deferred();
    const memory = f.memory;
    const oldGeneration = memory.getHistoryGeneration(target);
    const clear = f.memory.clearHistory(target, () => clearing.promise);
    expect(
        await memory.writeMemory(target, oldGeneration, async () => {
            throw new Error("stale write executed");
        }),
    ).toBe(false);
    let waited = false,
        written = false;
    const waiting = memory.waitForHistoryClear(target).then(() => {
        waited = true;
    });
    const fresh = memory.writeMemory(target, memory.getHistoryGeneration(target), async () => {
        written = true;
    });
    await Promise.resolve();
    expect(waited).toBe(false);
    expect(written).toBe(false);
    clearing.resolve();
    await Promise.all([clear, waiting, fresh]);
    expect(waited).toBe(true);
    expect(written).toBe(true);
});
for (const phase of ["read", "embedding", "write"]) {
    it(`waits for an index rebuild paused during ${phase} before completing stop`, async () => {
        const row = chunk("old-index", 1, "old content");
        const f = fixture([row]),
            entered = deferred(),
            gate = deferred();
        const wait = async () => {
            entered.resolve();
            await gate.promise;
        };
        if (phase === "read") f.reading(wait);
        if (phase === "embedding")
            f.embedding(async () => {
                await wait();
                return { embedding: [1, 0] };
            });
        if (phase === "write") f.setting(wait);
        const rebuilding = f.memory.rebuildIndex();
        await entered.promise;
        let stopped = false;
        const stopping = f.memory.stop().then(() => {
            stopped = true;
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(stopped).toBe(false);
        gate.resolve();
        await Promise.all([rebuilding, stopping]);
        expect(row.embedding).toEqual([1, 0]);
    });
}
it("does not start another index rebuild after stop", async () => {
    const row = chunk("old-index", 1, "old content");
    const f = fixture([row]);
    await f.memory.stop();
    await f.memory.rebuildIndex();
    expect(row.embedding).toEqual([0, 1]);
});
