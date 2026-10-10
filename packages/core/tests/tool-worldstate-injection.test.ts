import { expect, test } from "bun:test";
import { Context, Logger, Schema } from "koishi";
import { ToolService } from "../lib/services/extension/service";
import { Services } from "../src/shared/constants";

async function fixture() {
    const app = new Context();
    const warnings: string[] = [];
    app.on("internal/warning", (error) => warnings.push(error.message));
    app.set(Services.Logger, { getLogger: () => new Logger("tool-test") });
    app.set(Services.Prompt, {
        registerTemplate() {},
        registerSnippet() {},
    });
    app.plugin(ToolService, { extra: {}, advanced: { maxRetry: 0 } } as any);
    await app.start();
    const tools = app[Services.Tool];
    tools.registerTool({
        name: "probe",
        parameters: Schema.object({}),
        execute: async () => ({ status: "success", result: "delivered" }),
    } as any);
    return { app, tools, warnings };
}

test("tool invocation can run before WorldState without an undeclared dependency warning", async () => {
    const { app, tools, warnings } = await fixture();
    try {
        const result = await tools.invoke("probe", {}, { platform: "onebot", channelId: "test", userId: "user" } as any);
        expect(result).toEqual({ status: "success", result: "delivered" });
        expect(warnings.filter((message) => message.includes(Services.WorldState))).toEqual([]);
    } finally {
        await app.stop();
    }
});

test("tool invocation records results when WorldState becomes available", async () => {
    const { app, tools, warnings } = await fixture();
    const events: any[] = [];
    try {
        app.set(Services.WorldState, { recordSystemEvent: async (event: any) => events.push(event) });
        const result = await tools.invoke("probe", {}, { platform: "onebot", channelId: "test", userId: "user" } as any);
        expect(result.status).toBe("success");
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ type: "tool-result", platform: "onebot", channelId: "test" });
        expect(events[0].payload.status).toBe("success");
        expect(warnings.filter((message) => message.includes(Services.WorldState))).toEqual([]);
    } finally {
        await app.stop();
    }
});
