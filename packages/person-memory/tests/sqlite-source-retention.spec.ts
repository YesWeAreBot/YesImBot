import { createHash } from "node:crypto";

import { SQLiteDriver } from "@minatojs/driver-sqlite";
import { Context } from "koishi";
import { expect, it } from "vitest";

import { PersonStore, registerModels } from "../src/store";
it("retention leaves the actual WASM SQLite driver usable after 2000 expired sources", async (t) => {
    const ctx = new Context();
    ctx.plugin(SQLiteDriver, { path: ":memory:" });
    registerModels(ctx);
    await ctx.start();
    await ctx.database.prepared();
    t.onTestFinished(() => ctx.stop());
    const timestamp = Date.now() - 8 * 86400000;
    for (let i = 0; i < 2200; i++)
        await ctx.database.create("person_memory.sources", {
            key: createHash("sha256").update(String(i)).digest("hex"),
            scope: "mind:a",
            userId: "u",
            timestamp: timestamp + i,
            source: { id: String(i), userId: "u", name: "u", text: "old", timestamp: timestamp + i },
        });
    await new PersonStore(ctx.database, "review").capture("mind:a", { id: "fresh", userId: "u", name: "u", text: "new", timestamp: Date.now() });
    expect(await ctx.database.get("person_memory.sources", { scope: "mind:a" })).toHaveLength(201);
    expect((await ctx.database.get("person_memory.sources", { scope: "mind:a" })).some((row) => row.source.id === "fresh")).toBe(true);
});
