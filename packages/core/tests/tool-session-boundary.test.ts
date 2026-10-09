import { test, expect } from "bun:test";

import { Schema } from "koishi";

import { ToolService } from "../lib/services/extension/service";

test("model parameters cannot replace the authenticated tool session", async () => {
    const realSession = { channelId: "current", userId: "user" };
    let observed: any;
    const tool = {
        parameters: Schema.object({ action: Schema.string() }),
        execute: async (args: any) => {
            observed = args.session;
            return { status: "success" };
        },
    };
    const service = { getTool: () => tool, _logger: { info() {}, warn() {}, success() {} }, config: { advanced: { maxRetry: 0 } } };
    await ToolService.prototype.invoke.call(service, "person_memory", { action: "read", session: { channelId: "other", userId: "admin" } }, realSession as any);
    expect(observed).toBe(realSession);
});
