import { executeQuery } from "minato";
import { expect, it } from "vitest";

import { TableName } from "../src/shared/constants";
import { EventListenerManager } from "../src/world/event-listener";
import { InteractionManager } from "../src/world/interaction-manager";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

it("keeps bot-targeted channel events within both bot and channel", async () => {
    const rows = [
        { id: "shared", platform: "qq", channelId: "room", eventScope: "channel" },
        { id: "A-only", platform: "qq", channelId: "room", eventScope: "channel", botKey: JSON.stringify(["qq", "A"]) },
        { id: "B-only", platform: "qq", channelId: "room", eventScope: "channel", botKey: JSON.stringify(["qq", "B"]) },
        { id: "other-room", platform: "qq", channelId: "elsewhere", eventScope: "channel", botKey: JSON.stringify(["qq", "A"]) },
    ].map((row) => ({ ...row, timestamp: new Date(), message: row.id, type: "reminder" }));
    const manager: any = Object.create(InteractionManager.prototype);
    Object.assign(manager, {
        config: { l1_memory: {} },
        getAgentHistoryFromFile: async () => ({ events: [], consumedSourceIds: new Set() }),
        ctx: {
            database: {
                get: async (table: string, query: any) => (table === TableName.SystemEvents ? rows.filter((row) => executeQuery(row, query, "row")) : []),
            },
        },
    });
    const ids = async (bot?: string) => (await manager.getL1History("qq", "room", 20, bot)).map((event: any) => event.id);
    expect(await ids("A")).toEqual(["shared", "A-only"]);
    expect(await ids("B")).toEqual(["shared", "B-only"]);
    expect(await ids()).toEqual(["shared"]);
});

it("propagates a failed system-event write instead of acknowledging persistence", async () => {
    const manager: any = Object.create(InteractionManager.prototype);
    const failure = new Error("disk full");
    Object.assign(manager, {
        ctx: {
            database: {
                create: async () => {
                    throw failure;
                },
            },
        },
        logger: { error() {}, debug() {} },
    });
    await expect(manager.recordSystemEvent({ id: "task", platform: "qq", channelId: "room" })).rejects.toBe(failure);
});

it("records usable OneBot poke text when the adapter omits the rendering fields", async () => {
    const recorded: any[] = [];
    const listener: any = new EventListenerManager(
        stubCtx({}) as any,
        { observeChannel: async () => {}, recordSystemEvent: async (event: unknown) => recorded.push(event) } as any,
        {} as any,
        loggingStub(),
        {} as any,
    );
    await listener.handleNotice({ platform: "onebot", channelId: "group", subtype: "poke", event: { _data: { user_id: 10, target_id: 11 } } });
    expect(recorded[0].message).toBe("系统提示：10 戳了戳 11");
    expect(recorded[0].payload.details).toEqual({ authorId: 10, targetId: 11 });
});
