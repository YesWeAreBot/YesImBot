import { expect, it } from "vitest";

import { HistoryCommandManager } from "../src/world/commands";
function setup() {
    const actions = new Map();
    const removed: any[] = [];
    const events: any[] = [];
    const command = (name: string) => {
        const c: any = {
            subcommand: (suffix: string) => command(name + suffix),
            option: () => c,
            usage: () => c,
            example: () => c,
            action: (fn: any) => {
                actions.set(name, fn);
                return c;
            },
        };
        return c;
    };
    const logger = { debug() {}, info() {}, warn() {}, error() {} };
    const ctx: any = {
        command,
        logger,
        database: {
            get: async () => [],
            remove: async (table: any, query: any) => {
                removed.push({ table, query });
                return { removed: 0 };
            },
        },
    };
    const service: any = {
        l2_manager: { clearHistory: async (_: any, fn: any) => fn() },
        l1_manager: { clearAgentHistory: async () => 0 },
        recordSystemEvent: async (e: any) => events.push(e),
    };
    new HistoryCommandManager(ctx, service, {} as any, { getLogger: () => logger } as any).register();
    return {
        invoke: (options: any) =>
            actions.get("history.clear")({ session: { platform: "telegram", channelId: "7", guildId: "-1001", isDirect: false }, options }),
        removed,
        events,
    };
}
it("preserves an explicit canonical topic target", async () => {
    const f = setup();
    const key = 'telegram-topic:["-1001","7"]';
    await f.invoke({ target: `telegram:${key}` });
    expect(f.removed[0].query.channelId).toBe(key);
});
it("records the clear receipt in the current topic", async () => {
    const f = setup();
    await f.invoke({});
    expect(f.events[0].channelId).toBe('telegram-topic:["-1001","7"]');
    expect(f.removed[0].query.channelId).toBe('telegram-topic:["-1001","7"]');
});
it("preserves tuple targets in channel lists alongside ordinary channels", async () => {
    const f = setup();
    const key = 'telegram-topic:["-1001","7"]';
    await f.invoke({ channel: `${key},ordinary`, platform: "telegram" });
    expect(f.removed.some((item) => item.query.channelId === key)).toBe(true);
    expect(f.removed.some((item) => item.query.channelId === "ordinary")).toBe(true);
});
it("preserves multiple qualified targets", async () => {
    const f = setup();
    const key = 'telegram-topic:["-1001","7"]';
    await f.invoke({ target: `telegram:${key},onebot:room` });
    expect(f.removed.some((item) => item.query.channelId === key)).toBe(true);
    expect(f.removed.some((item) => item.query.channelId === "room" && item.query.platform === "onebot")).toBe(true);
});
