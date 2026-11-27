import memory from "@koishijs/plugin-database-memory";
import { Context } from "koishi";
import { expect, it } from "vitest";

import FavorExtension from "../src/index";
it("does not lose concurrent adjustments across separate extension instances", async () => {
    const ctx = new Context();
    ctx.plugin(memory);
    ctx.model.extend("favor_scoped", { platform: "string", user_id: "string", amount: "double" }, { primary: ["platform", "user_id"] });
    await ctx.start();
    await ctx.database.prepared();
    try {
        const make = () =>
            Object.assign(Object.create(FavorExtension.prototype), {
                ctx,
                config: { initialFavor: 0, maxFavor: 100 },
                disposed: false,
                logger: { info() {}, error() {} },
            });
        const a = make(),
            b = make();
        const results = await Promise.all(
            Array.from({ length: 16 }, (_, i) => (i % 2 ? a : b).addFavor({ session: { platform: "onebot" }, user_id: "u", amount: 1 })),
        );
        expect(results.map((r) => r.status)).toEqual(new Array(16).fill("success"));
        expect((await ctx.database.get("favor_scoped", { platform: "onebot", user_id: "u" }))[0].amount).toBe(16);
    } finally {
        await ctx.stop();
    }
});
