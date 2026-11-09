import memory from "@koishijs/plugin-database-memory";
import { Bot, Context } from "koishi";
import { expect, it, onTestFinished } from "vitest";

import { TableName } from "../src/shared/constants";
import { EventListenerManager } from "../src/world/event-listener";
import { SemanticMemoryManager } from "../src/world/l2-semantic-memory";
import { WorldStateService } from "../src/world/service";
import { loggingStub } from "./helpers/yesimbot";

function deferred() {
    let resolve!: () => void;
    return {
        promise: new Promise<void>((r) => {
            resolve = r;
        }),
        resolve: () => resolve(),
    };
}
async function fixture(transform: (text: string) => Promise<string>) {
    const app = new Context();
    app.plugin(memory);
    (WorldStateService.prototype as any).registerModels.call({ ctx: app });
    await app.start();
    await app.database.prepared();
    onTestFinished(() => app.stop());
    const config: any = { l2_memory: { enabled: false }, l3_memory: { enabled: false } };
    const logging = loggingStub();
    const l2_manager = new SemanticMemoryManager(app, config, logging, {} as any);
    const world = Object.assign(Object.create(WorldStateService.prototype), {
        ctx: app,
        config,
        l2_manager,
        l1_manager: { recordMessage: (row: any) => app.database.create(TableName.Messages, row) },
    });
    const listener: any = new EventListenerManager(app, world, {} as any, logging, { transform } as any);
    const bot = Object.assign(Object.create(Bot.prototype), { ctx: app, platform: "onebot", user: { id: "bot" } });
    const target = { platform: "onebot", channelId: "room" };
    return {
        app,
        l2_manager,
        world,
        target,
        record: (id: string, direction: "sent" | "received" = "sent") => {
            const session = bot.session({
                type: direction === "sent" ? "after-send" : "message",
                user: { id: "user", name: "User" },
                channel: { id: "room", type: 0 },
                message: { id, content: id },
                timestamp: Date.now(),
            });
            session.content = id;
            return direction === "sent" ? listener.recordBotSentMessage(session) : listener.recordUserMessage(session);
        },
        rows: () => app.database.get(TableName.Messages, target),
    };
}

it.each(["sent", "received"] as const)(
    "does not resurrect an old %s message when asynchronous asset processing settles after history clear",
    async (direction) => {
        const entered = deferred(),
            release = deferred();
        const f = await fixture(async (text) => {
            entered.resolve();
            await release.promise;
            return text;
        });
        const old = f.record("old-confirmed", direction);
        await entered.promise;
        await f.l2_manager.clearHistory(f.target, () => f.app.database.remove(TableName.Messages, f.target));
        release.resolve();
        await old;
        expect(await f.rows()).toEqual([]);
    },
);

it.each([
    ["sent", false],
    ["sent", true],
    ["received", false],
    ["received", true],
] as const)("preserves a fresh %s message accepted during clear, including an unobserved target with typed clear %s", async (direction, typed) => {
    const entered = deferred(),
        release = deferred();
    const f = await fixture(async (text) => text);
    const clear = f.l2_manager.clearHistory(typed ? { type: "guild" } : f.target, async () => {
        entered.resolve();
        await release.promise;
        await f.app.database.remove(TableName.Messages, f.target);
    });
    await entered.promise;
    const fresh = f.record("fresh-confirmed", direction);
    release.resolve();
    await clear;
    await fresh;
    expect(await f.rows()).toMatchObject([{ id: "fresh-confirmed", content: "fresh-confirmed", sender: { id: direction === "sent" ? "bot" : "user" } }]);
});
