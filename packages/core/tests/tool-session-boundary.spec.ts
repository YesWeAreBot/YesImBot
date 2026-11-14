import { Schema } from "koishi";
import { test, expect } from "vitest";

import { ToolService } from "../src/extension/service";
import { loggingStub } from "./helpers/yesimbot";

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
    const service = new ToolService({} as any, { advanced: { maxRetry: 0 } } as any, { logging: loggingStub() } as any);
    service.getTool = () => tool as any;
    await ToolService.prototype.invoke.call(service, "person_memory", { action: "read", session: { channelId: "other", userId: "admin" } }, realSession as any);
    expect(observed).toBe(realSession);
});
