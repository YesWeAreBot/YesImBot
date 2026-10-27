import memory from "@koishijs/plugin-database-memory";
import pluginMock from "@koishijs/plugin-mock";
import { Context, Schema } from "koishi";
import { expect, it, onTestFinished } from "vitest";

import { Config } from "../src/config";
import { ToolService } from "../src/extension/service";
import { loggingStub } from "./helpers/yesimbot";

it("allows authority-3 cancellation while keeping ordinary members behind the command permission gate", async () => {
    const ctx = new Context();
    ctx.plugin(memory);
    const fork = ctx.plugin((pluginMock as any).default ?? pluginMock);
    let release!: () => void;
    const external = new Promise<void>((resolve) => (release = resolve));
    const config = Config({ backgroundTools: { enabled: true, allowedTools: ["lookup"] } });
    const tools = new ToolService(ctx, config, {
        logging: loggingStub(),
        world: {
            isChannelAllowed: () => true,
            l2_manager: { getHistoryGeneration: () => 0, watchHistory: () => () => {} },
            recordSystemEvent: async () => true,
        },
    } as any);
    tools.registerTool({
        name: "lookup",
        description: "lookup",
        background: true,
        parameters: Schema.object({}),
        execute: async () => {
            await external;
            return { status: "success" };
        },
    });
    tools.background!.registerCommands();
    onTestFinished(async () => {
        release();
        await tools.stop();
        await fork.dispose();
        await ctx.stop();
    });
    await ctx.start();
    await ctx.database.prepared();
    await ctx.mock.initUser("admin", 3);
    await ctx.mock.initUser("member", 1);
    await ctx.mock.initChannel("room");
    const session = ctx.mock.session({ channel: { id: "room", type: 0 }, guild: { id: "room" }, user: { id: "admin" } });
    const result: any = await tools.invoke("background_task_start", { tool: "lookup", params: {} }, session);
    expect(result.status).toBe("success");
    const id = result.result.id;
    await ctx.mock.client("member", "room").receive(`tool.tasks.cancel ${id}`);
    expect((tools.background!.query(session, id) as any).state).toBe("running");
    const output = await ctx.mock.client("admin", "room").receive(`tool.tasks.cancel ${id}`);
    expect(output.join("")).toContain("cancelling");
});
