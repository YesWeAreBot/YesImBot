import { expect, it } from "vitest";

import { EventListenerManager } from "../src/services/worldstate/event-listener";
import { Services } from "../src/shared/constants";
it("records mixed adapter role formats as IDs while keeping message XML", async () => {
    const messages: any[] = [],
        members: any[] = [];
    const ctx = {
        [Services.Logger]: { getLogger: () => ({ debug() {}, info() {}, error() {} }) },
        [Services.Asset]: { transform: async (s: string) => s },
        database: {
            get: async () => [],
            create: async (_table: string, value: any) => {
                members.push(value);
            },
        },
    };
    const listener = new EventListenerManager(
        ctx as any,
        {
            recordMessage: async (value: any) => {
                messages.push(value);
            },
        } as any,
        {} as any,
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
    const { InteractionManager } = await import("../src/services/worldstate/interaction-manager");
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
