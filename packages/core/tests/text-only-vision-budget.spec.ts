import { it, expect, vi } from "vitest";

import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { PromptService } from "../src/prompt/service";
import { stubCtx, loggingStub } from "./helpers/yesimbot";
const world: any = {
    self: { id: "bot" },
    channel: { platform: "qq", id: "c", type: "guild" },
    l1_working_memory: { new_events: [], processed_events: [] },
    l2_retrieved_memories: [],
    l3_diary_entries: [],
};
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const ctx = stubCtx({});
async function prompt() {
    const p = new PromptService(ctx, { injectionPlaceholder: "ext" } as any, loggingStub(log));
    await p.start();
    return p;
}
const m = (id: string, content: string, elements: any[] = []) => ({ type: "message", id, content, elements, timestamp: new Date(), sender: { id: "u" } });

it("vision toggle preserves text history for a text-only model group", async () => {
    const p = await prompt();
    p.registerTemplate("agent.system", "hello");
    p.registerTemplate(
        "agent.user",
        "{{#WORLD_STATE.l1_working_memory.processed_events}}{{content}}{{/WORLD_STATE.l1_working_memory.processed_events}} {{#WORLD_STATE.l1_working_memory.new_events}}{{content}}{{/WORLD_STATE.l1_working_memory.new_events}}",
    );
    const state = {
        ...world,
        l1_working_memory: {
            processed_events: [m("old", "retain my context")],
            new_events: [m("current", "current", [{ type: "img", attrs: { id: "one" } }])],
        },
    };
    async function run(enableVision: boolean) {
        const proc = new HeartbeatProcessor(
            ctx,
            { nativeToolCalling: false, contextInputBudgetTokens: 800, enableVision, maxImagesInContext: 1, detail: "low" } as any,
            {
                model: { hasVisionCapability: () => false },
                prompt: p,
                tool: {},
                world: {},
                l1: {},
                logging: loggingStub(log),
                contextBuilder: {
                    build: async () => ({ toolSchemas: [], memoryBlocks: [], worldState: state }),
                    buildMultimodalUserMessage: async (t: string) => t,
                },
            } as any,
        );
        return (
            await (proc as any)._prepareLlmRequest({
                session: { platform: "qq", selfId: "bot", userId: "u", channelId: "c" },
                type: "user_message",
                payload: { messageIds: ["current"] },
            })
        ).messages[1].content;
    }
    expect(await run(false)).toContain("retain my context");
    expect(await run(true)).toContain("retain my context");
});
