import { createHash } from "node:crypto";

import { expect, it, vi } from "vitest";

import { PersonStore, registerModels } from "../src/store";
import { fixture } from "./helpers";

const table = "person_memory.sources";
const key = (id: string) => createHash("sha256").update(id).digest("hex");
const oldTime = Date.now() - 8 * 86400000;
async function seed(t, count = 2200) {
    const ctx = await fixture(t, registerModels);
    await ctx.database.upsert(
        table,
        Array.from({ length: count }, (_, i) => ({
            key: key(String(i)),
            scope: "mind:a",
            userId: "u",
            timestamp: oldTime + i,
            source: { id: String(i), userId: "u", name: "u", text: "old", timestamp: oldTime + i },
        })),
    );
    await ctx.database.create(table, {
        key: key("other"),
        scope: "mind:b",
        userId: "u",
        timestamp: oldTime,
        source: { id: "other", userId: "u", name: "u", text: "other", timestamp: oldTime },
    });
    return ctx;
}
const fresh = { id: "fresh", userId: "u", name: "u", text: "new", timestamp: Date.now() };

it("cleans a full expired page with bounded queries while preserving the newest sources and other domains", async (t) => {
    const ctx = await seed(t);
    const remove = vi.spyOn(ctx.database, "remove");
    await new PersonStore(ctx.database, "review").capture("mind:a", fresh);
    const calls = remove.mock.calls.filter(([name]) => name === table);
    expect(calls.length).toBeGreaterThan(1);
    for (const [, query] of calls) {
        expect(query.scope).toBe("mind:a");
        expect(query.key.$in.length).toBeLessThanOrEqual(128);
    }
    const rows = await ctx.database.get(table, { scope: "mind:a" });
    expect(rows).toHaveLength(201);
    expect(rows.some((row) => row.source.id === "fresh")).toBe(true);
    for (let i = 2001; i < 2200; i++) expect(rows.some((row) => row.source.id === String(i))).toBe(true);
    expect(await ctx.database.get(table, { scope: "mind:b" })).toHaveLength(1);
});

it("stops deleting between cleanup batches after the capture is cancelled", async (t) => {
    const ctx = await seed(t, 500);
    let active = true;
    const original = ctx.database.remove.bind(ctx.database);
    const remove = vi.spyOn(ctx.database, "remove").mockImplementation(async (...args) => {
        const result = await original(...args);
        active = false;
        return result;
    });
    await new PersonStore(ctx.database, "review").capture("mind:a", fresh, () => active);
    expect(remove).toHaveBeenCalledTimes(1);
    const rows = await ctx.database.get(table, { scope: "mind:a" });
    expect(rows.length).toBeGreaterThan(200);
    expect(rows.some((row) => row.source.id === "fresh")).toBe(true);
});
