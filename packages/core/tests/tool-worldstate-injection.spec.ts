import { Context, Logger, Schema } from "koishi";
import type { Session } from "koishi";
import { expect, test } from "vitest";

import type { Config } from "../src/config";
import { ToolService } from "../src/services/extension/service";
import type { ToolDefinition } from "../src/services/extension/types";
import { Services } from "../src/shared/constants";

// The stub only needs the session fields invoke() reads on this path; a real Session is far larger.
const session = { platform: "onebot", channelId: "test", userId: "user" } as unknown as Session;
// Partial config: ToolService resolves every other field from its schema defaults at runtime.
const toolConfig = { extra: {}, advanced: { maxRetry: 0 } } as unknown as Config;

async function fixture() {
    const app = new Context();
    const warnings: string[] = [];
    app.on("internal/warning", (error) => warnings.push(error.message));
    app.set(Services.Logger, { getLogger: () => new Logger("tool-test") });
    app.set(Services.Prompt, {
        registerTemplate() {},
        registerSnippet() {},
    });
    app.plugin(ToolService, toolConfig);
    await app.start();
    const tools = app[Services.Tool];
    // Raw definition without a description: registerTool() only reads name/parameters/execute here.
    const probe = {
        name: "probe",
        parameters: Schema.object({}),
        execute: async () => ({ status: "success", result: "delivered" }),
    } as unknown as ToolDefinition;
    tools.registerTool(probe);
    return { app, tools, warnings };
}

test("tool invocation can run before WorldState without an undeclared dependency warning", async () => {
    const { app, tools, warnings } = await fixture();
    try {
        const result = await tools.invoke("probe", {}, session);
        expect(result).toEqual({ status: "success", result: "delivered" });
        expect(warnings.filter((message) => message.includes(Services.WorldState))).toEqual([]);
    } finally {
        await app.stop();
    }
});

test("tool invocation records results when WorldState becomes available", async () => {
    const { app, tools, warnings } = await fixture();
    const events: Array<{ type: string; platform: string; channelId: string; payload: { status: string } }> = [];
    try {
        app.set(Services.WorldState, {
            recordSystemEvent: async (event: { type: string; platform: string; channelId: string; payload: { status: string } }) => {
                events.push(event);
            },
        });
        const result = await tools.invoke("probe", {}, session);
        expect(result.status).toBe("success");
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ type: "tool-result", platform: "onebot", channelId: "test" });
        expect(events[0].payload.status).toBe("success");
        expect(warnings.filter((message) => message.includes(Services.WorldState))).toEqual([]);
    } finally {
        await app.stop();
    }
});
