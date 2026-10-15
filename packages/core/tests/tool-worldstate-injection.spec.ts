import { Context, Logger, Schema } from "koishi";
import type { Session } from "koishi";
import { expect, test } from "vitest";

import type { Config } from "../src/config";
import { ToolService } from "../src/extension/service";
import type { ToolDefinition } from "../src/extension/types";

// The stub only needs the session fields invoke() reads on this path; a real Session is far larger.
const session = { platform: "onebot", channelId: "test", userId: "user" } as unknown as Session;
// Partial config: ToolService resolves every other field from its schema defaults at runtime.
const toolConfig = { extra: {}, advanced: { maxRetry: 0 } } as unknown as Config;

type WorldEvent = { type: string; platform: string; channelId: string; payload: { status: string } };
/** WorldState 的最小桩：invoke() 只读 `recordSystemEvent`。 */
type WorldStub = { recordSystemEvent: (event: WorldEvent) => Promise<void> };
/** 构造注入的依赖槽位类型，避免在此处重复声明。 */
type ToolDeps = ConstructorParameters<typeof ToolService>[2];

/**
 * 依赖改为构造注入：`world` 在构造时传入，缺席时由 invoke() 的 `world?.recordSystemEvent` 守卫跳过事件记录。
 */
function fixture(world?: WorldStub) {
    const deps = {
        logging: { getLogger: () => new Logger("tool-test") },
        prompt: { registerTemplate() {}, registerSnippet() {} },
        world,
    };
    // Partial Context stub: ToolService is no longer a Koishi plugin and its dependencies are
    // injected explicitly, so nothing on this path reads ctx anymore.
    const ctx = {} as unknown as Context;
    const tools = new ToolService(ctx, toolConfig, deps as unknown as ToolDeps);
    // Raw definition without a description: registerTool() only reads name/parameters/execute here.
    const probe = {
        name: "probe",
        parameters: Schema.object({}),
        execute: async () => ({ status: "success", result: "delivered" }),
    } as unknown as ToolDefinition;
    tools.registerTool(probe);
    return { tools };
}

test("tool invocation can run before WorldState is available", async () => {
    const { tools } = fixture();
    const result = await tools.invoke("probe", {}, session);
    expect(result).toEqual({ status: "success", result: "delivered" });
});

test("tool invocation records results when WorldState becomes available", async () => {
    const events: WorldEvent[] = [];
    const { tools } = fixture({
        recordSystemEvent: async (event: WorldEvent) => {
            events.push(event);
        },
    });
    const result = await tools.invoke("probe", {}, session);
    expect(result.status).toBe("success");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "tool-result", platform: "onebot", channelId: "test" });
    expect(events[0].payload.status).toBe("success");
});
