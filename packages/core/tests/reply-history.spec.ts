import { expect, it } from "vitest";

import type { AssetService } from "../src/asset";
import { EventListenerManager } from "../src/world/event-listener";
import { loggingStub, stubCtx } from "./helpers/yesimbot";
it("records mixed adapter role formats as IDs while keeping message XML", async () => {
    const messages: any[] = [],
        members: any[] = [];
    const logger = { debug() {}, info() {}, error() {} };
    const asset = { transform: async (message: string) => message };
    const ctx = stubCtx(
        { logging: { getLogger: () => logger }, asset },
        {
            database: {
                get: async () => [],
                create: async (_table: string, value: any) => {
                    members.push(value);
                },
            },
        },
    );
    const listener = new EventListenerManager(
        ctx as any,
        {
            recordMessage: async (value: any) => {
                messages.push(value);
            },
            observeChannel: async () => {},
        } as any,
        {} as any,
        loggingStub(logger),
        // 测试桩只实现被测路径读取的 transform，无法满足完整 AssetService 契约。
        asset as unknown as AssetService,
    );
    await (listener as any).recordUserMessage({
        author: { name: "user", roles: ["member", { id: "admin" }] },
        guildId: "g",
        userId: "u",
        platform: "onebot",
        channelId: "g",
        cid: "onebot:g",
        timestamp: Date.now(),
        content: '<at id="bot"/>text',
        toJSON: () => ({ message: { content: '<at id="bot"/>text' } }),
        messageId: "m",
    });
    expect(messages[0].sender.roles).toEqual(["member", "admin"]);
    expect(members[0].roles).toEqual(["member", "admin"]);
    expect(messages[0].content).toBe('<at id="bot"/>text');
});
it("reads operation events only from the requested platform into the visible context", async () => {
    const { InteractionManager } = await import("../src/world/interaction-manager");
    const now = new Date();
    const events = [
        { id: "1", platform: "onebot", channelId: "same", type: "reply-control", timestamp: now, message: "暂停 at 到期时间" },
        { id: "2", platform: "discord", channelId: "same", type: "reply-control", timestamp: now, message: "other" },
    ];
    const manager = Object.create(InteractionManager.prototype);
    manager.ctx = {
        database: {
            get: async (table: string, query: any) =>
                table === "worldstate.system_events"
                    ? events.filter((e) => (!query.platform || query.platform === e.platform) && query.channelId === e.channelId)
                    : [],
        },
    };
    manager.getAgentHistoryFromFile = async () => [];
    const context = await manager.getL1History("onebot", "same", 10);
    expect(context).toHaveLength(1);
    expect(context[0].message).toBe("暂停 at 到期时间");
});
