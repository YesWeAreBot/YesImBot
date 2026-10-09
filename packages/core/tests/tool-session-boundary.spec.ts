import { Schema } from "koishi";
import { test, expect } from "vitest";

import { ToolService } from "../src/services/extension/service";

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
    // Partial stub of ToolService: only the members invoke() touches on this path.
    const service = {
        getTool: () => tool,
        _logger: { info() {}, warn() {}, success() {} },
        config: { advanced: { maxRetry: 0 } },
        executeInvocation: ToolService.prototype["executeInvocation"],
        // invoke() reads this.ctx[Services.WorldState] after execution; the stub context is empty on purpose.
        ctx: {},
    } as unknown as ToolService;
    await ToolService.prototype.invoke.call(service, "person_memory", { action: "read", session: { channelId: "other", userId: "admin" } }, realSession as any);
    expect(observed).toBe(realSession);
});
