import memory from "@koishijs/plugin-database-memory";
import { Bot, Context } from "koishi";
import { expect, it, onTestFinished } from "vitest";

import { TableName } from "../src/shared/constants";
import { WorldStateService } from "../src/world/service";

async function fixture() {
    const ctx = new Context();
    ctx.plugin(memory);
    (WorldStateService.prototype as any).registerModels.call({ ctx });
    await ctx.start();
    await ctx.database.prepared();
    onTestFinished(() => ctx.stop());
    const bot = Object.assign(Object.create(Bot.prototype), { ctx, platform: "onebot", user: { id: "bot" } });
    const session = bot.session({ type: "message", channel: { id: "room", type: 0 }, guild: { id: "room" }, user: { id: "alice" } });
    const world = Object.assign(Object.create(WorldStateService.prototype), {
        ctx,
        config: { allowedChannels: ["onebot", "other"].flatMap((platform) => ["guild", "private"].map((type) => ({ platform, type, id: "*" }))) },
        l2_manager: { waitForHistoryClear: async () => {}, getHistoryGeneration: () => 0 },
    });
    await ctx.database.create(TableName.Messages, {
        platform: "onebot",
        channelId: "room",
        id: "raw",
        sender: { id: "alice" },
        timestamp: new Date(),
        content: "original target secret",
    });
    await ctx.database.create(TableName.L2Chunks, {
        platform: "onebot",
        channelId: "room",
        id: "memory",
        content: "original target memory",
        participantIds: ["alice"],
        startTimestamp: new Date(),
        endTimestamp: new Date(),
    });
    return { ctx, world, session };
}

const mutations = {
    channel: (s: any) => {
        s.event.channel.id = "other-room";
    },
    user: (s: any) => {
        s.event.user.id = "bob";
    },
    guild: (s: any) => {
        s.event.guild.id = "other-guild";
    },
    type: (s: any) => {
        s.event.channel.type = 1;
    },
    platform: (s: any) => {
        s.event.platform = "other";
    },
    bot: (s: any) => {
        s.event.selfId = "other-bot";
    },
};

for (const phase of ["history-wait", "database", "filter"] as const) {
    for (const [identity, mutate] of Object.entries(mutations)) {
        it(`rejects ${identity} identity changes during recall ${phase}`, async () => {
            const f = await fixture();
            if (phase === "history-wait")
                f.world.l2_manager.waitForHistoryClear = async () => {
                    mutate(f.session);
                };
            if (phase === "database") {
                const get = f.ctx.database.get.bind(f.ctx.database);
                f.ctx.database.get = (async (...args: any[]) => {
                    const rows = await (get as any)(...args);
                    mutate(f.session);
                    return rows;
                }) as any;
            }
            let filters = 0;
            f.ctx.on("yesimbot/filter-recalled-memory", () => {
                filters++;
                if (phase === "filter") mutate(f.session);
            });
            await expect(f.world.recallContext(f.session, { kind: phase === "filter" ? "l2" : "messages" })).rejects.toThrow(/会话身份/);
            expect(filters).toBe(phase === "filter" ? 1 : 0);
        });
    }
}

it("preserves valid reads with an unchanged identity and applies the memory filter", async () => {
    const f = await fixture();
    expect((await f.world.recallContext(f.session, { kind: "messages" })).records[0].content).toBe("original target secret");
    f.ctx.on("yesimbot/filter-recalled-memory", (_session, state) => {
        state.l2_retrieved_memories = [];
    });
    expect((await f.world.recallContext(f.session, { kind: "l2" })).records).toEqual([]);
});
