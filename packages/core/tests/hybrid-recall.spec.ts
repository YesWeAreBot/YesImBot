import { expect, it, vi } from "vitest";

import { SemanticMemoryManager } from "../src/services/worldstate/l2-semantic-memory";
import { Services, TableName } from "../src/shared/constants";

const target = { platform: "onebot", channelId: "room" };
const scoped = { ...target, k: 3, startTimestamp: new Date(100), endTimestamp: new Date(900) };
function chunk(id: string, content: string, embedding = [0, 1], extra = {}) {
    return { id, ...target, content, embedding, participantIds: ["alice"], startTimestamp: new Date(200), endTimestamp: new Date(300), ...extra };
}
function source(id: string, content: string, extra = {}) {
    return { id, ...target, content, sender: { id: "alice", name: "Alice" }, timestamp: new Date(250), ...extra };
}
function fixture(rows: Record<string, any[]>, embed?: (text: string) => Promise<{ embedding: number[] }>) {
    const queries: any[] = [];
    const warn = vi.fn();
    const ctx: any = {
        [Services.Logger]: { getLogger: () => ({ warn, info() {}, error() {}, debug() {} }) },
        [Services.Model]: { useEmbeddingGroup: () => (embed ? { getModels: () => [{ embed }] } : undefined) },
        database: {
            get: async (table: string, query: any, modifier: any) => {
                queries.push({ table, query, modifier });
                // Deliberately include legacy/out-of-scope rows: recall must verify the boundary itself.
                return rows[table] || [];
            },
        },
    };
    const memory = new SemanticMemoryManager(ctx, { l2_memory: { enabled: true, includeNeighborChunks: false, retrievalMinSimilarity: 0.5 } } as any);
    memory.start();
    return { memory, queries, warn };
}
it("recalls stored chunks and real source messages without an embedding model within strict target/time bounds", async () => {
    const f = fixture({
        [TableName.L2Chunks]: [
            chunk("lexical", "orchid"),
            chunk("wrong-room", "orchid", [], { channelId: "elsewhere" }),
            chunk("future", "orchid", [], { endTimestamp: new Date(1000) }),
        ],
        [TableName.Messages]: [
            source("raw", "orchid watering"),
            source("wrong-platform", "orchid", { platform: "discord" }),
            source("old", "orchid", { timestamp: new Date(10) }),
        ],
    });
    const result = await f.memory.search("orchid", scoped);
    expect(result.map((row) => row.content)).toEqual(expect.arrayContaining(["orchid", "Alice: orchid watering"]));
    expect(result).toHaveLength(2);
    expect(result.find((row) => row.id === "message:raw")?.embedding).toEqual([]);
    expect(result.every((row) => (row as any).retrievalMethod === "keyword")).toBe(true);
    expect(f.queries.every(({ modifier }) => modifier.limit > 0 && modifier.limit <= 200)).toBe(true);
});
it("falls back when the embedding request fails and reports the degradation", async () => {
    const f = fixture({ [TableName.L2Chunks]: [chunk("lexical", "orchid")] }, async () => {
        throw new Error("offline");
    });
    expect((await f.memory.search("orchid", scoped)).map((row) => row.id)).toEqual(["lexical"]);
    expect(f.warn).toHaveBeenCalledWith(expect.stringContaining("关键词"));
});
it("fuses keyword hits with semantic hits and removes overlapping source copies", async () => {
    const f = fixture(
        {
            [TableName.L2Chunks]: [chunk("semantic", "care instructions", [1, 0]), chunk("lexical", "Alice: orchid watering")],
            [TableName.Messages]: [source("raw", "orchid watering")],
        },
        async () => ({ embedding: [1, 0] }),
    );
    const result = await f.memory.search("orchid", scoped);
    const content = result.map((row) => row.content).join("\n");
    expect(content).toContain("care instructions");
    expect(content.match(/orchid watering/g)).toHaveLength(1);
});
it("does not run keyword/source lookup without a complete target or for invalid query limits", async () => {
    const f = fixture({ [TableName.L2Chunks]: [chunk("lexical", "orchid")] });
    expect(await f.memory.search("orchid", { platform: target.platform })).toEqual([]);
    for (const k of [NaN, Infinity, -1, 0]) expect(await f.memory.search("orchid", { ...scoped, k })).toEqual([]);
    expect(f.queries).toHaveLength(0);
});
it("bounds query length and candidate count even if the database ignores the limit", async () => {
    const seen: string[] = [];
    const f = fixture({ [TableName.L2Chunks]: Array.from({ length: 500 }, (_, i) => chunk(String(i), "orchid")) }, async (text) => {
        seen.push(text);
        return { embedding: [1, 0] };
    });
    const result = await f.memory.search("x".repeat(10000) + " orchid", { ...scoped, k: 10000 });
    expect(seen[0].length).toBeLessThanOrEqual(2000);
    expect(result.length).toBeLessThanOrEqual(12);
    expect(f.queries.every(({ modifier }) => modifier.limit <= 200)).toBe(true);
});
it("does not infer adjacency between keyword matches when intervening history was not loaded", async () => {
    const f = fixture({
        [TableName.L2Chunks]: [chunk("old", "orchid old"), chunk("new", "orchid new", [], { startTimestamp: new Date(700), endTimestamp: new Date(800) })],
    });
    expect((await f.memory.search("orchid", scoped)).map((row) => row.id)).toEqual(["old", "new"]);
});
