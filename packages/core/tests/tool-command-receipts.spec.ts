import memory from "@koishijs/plugin-database-memory";
import pluginMock from "@koishijs/plugin-mock";
import { Context, Schema } from "koishi";
import { expect, it, onTestFinished } from "vitest";

import { Config } from "../src/config";
import { ToolService } from "../src/extension/service";
import type { SystemEventData } from "../src/world/types";
import { loggingStub } from "./helpers/yesimbot";

async function fixture() {
    const ctx = new Context();
    ctx.plugin(memory);
    const mockFork = ctx.plugin((pluginMock as any).default ?? pluginMock);
    onTestFinished(async () => {
        mockFork.dispose();
        await ctx.stop();
    });
    const events: SystemEventData[] = [];
    const tools = new ToolService(ctx, Config({}), {
        logging: loggingStub(),
        prompt: {} as any,
        world: {
            async recordSystemEvent(event: SystemEventData) {
                events.push(event);
                return true;
            },
        } as any,
    });
    tools.registerTool({
        name: "receipt_probe",
        description: "receipt test",
        parameters: Schema.object({}),
        execute: async () => ({ status: "success", result: "delivered" }),
    });
    (tools as any).registerCommands();
    await ctx.start();
    await ctx.database.prepared();
    await ctx.mock.initUser("admin", 3);
    await ctx.mock.initUser("member", 1);
    await ctx.mock.initChannel("room");
    return { ctx, tools, events };
}

it("attributes an actual tool.invoke command receipt to the administrator", async () => {
    const { ctx, events } = await fixture();
    const output = await ctx.mock.client("admin", "room").receive("tool.invoke receipt_probe");

    expect(output.join("")).toContain("调用成功");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
        type: "tool-result",
        platform: "mock",
        channelId: "room",
        payload: { actor: "admin:mock:admin", requester: "admin", operation: "receipt_probe", status: "success" },
    });
});

it("keeps the authority gate ahead of tool execution and receipt recording", async () => {
    const { ctx, events } = await fixture();
    const output = await ctx.mock.client("member", "room").receive("tool.invoke receipt_probe");

    expect(output.join("")).not.toContain("调用成功");
    expect(events).toEqual([]);
});

it("attributes a model invocation receipt to the model", async () => {
    const { ctx, tools, events } = await fixture();
    const session = ctx.mock.session({
        type: "message",
        channel: { id: "room", type: 0 },
        guild: { id: "room" },
        user: { id: "member" },
    });
    expect((await tools.invoke("receipt_probe", {}, session)).status).toBe("success");
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ actor: "model", requester: "member", operation: "receipt_probe", status: "success" });
});
