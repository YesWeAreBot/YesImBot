import { Schema } from "koishi";
import { expect, it } from "vitest";

import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

for (const mode of ["normal", "streaming", "native"] as const) {
    it(`carries and seals one task request across ${mode} heartbeat actions`, async () => {
        const requests: string[] = [],
            sealed: string[] = [];
        const action = { function: "background_task_start", params: { tool: "web_search", params: { query: "topic" } } };
        const processor = new HeartbeatProcessor(
            stubCtx({}),
            { heartbeat: 1, nativeToolCalling: mode === "native", streamAction: mode === "streaming" } as any,
            {
                model: {
                    chat: async () =>
                        mode === "native"
                            ? { toolCalls: [{ toolName: action.function, args: JSON.stringify(action.params), toolCallId: "one" }] }
                            : { text: JSON.stringify({ thoughts: {}, actions: [action], request_heartbeat: false }) },
                } as any,
                prompt: {} as any,
                contextBuilder: {} as any,
                logging: loggingStub(),
                world: {} as any,
                tool: {
                    background: { sealRequest: (_s: unknown, id: string) => sealed.push(id) },
                    getAvailableTools: () => [{ name: action.function, parameters: Schema.object({ tool: Schema.string(), params: Schema.any() }) }],
                    getTool: () => ({ parameters: Schema.object({ tool: Schema.string(), params: Schema.any() }) }),
                    invoke: async (_name: string, _params: unknown, _session: unknown, context: any) => {
                        requests.push(context.requestId);
                        return { status: "success", result: { id: "task" } };
                    },
                } as any,
                l1: {
                    recordThought: async () => {},
                    recordAction: async () => "action",
                    recordObservation: async () => {},
                    recordHeartbeat: async () => {},
                } as any,
            },
        );
        (processor as any)._prepareLlmRequest = async () => ({ messages: [], manualRecallIds: [] });
        await processor.runCycle({ decisionId: "turn", session: { platform: "test", selfId: "bot", channelId: "room" } } as any);
        expect(requests).toEqual(["turn"]);
        expect(sealed).toEqual(["turn"]);
    });
}
it("injects escaped task progress even when custom prompt templates omit world state", async () => {
    const processor = new HeartbeatProcessor(stubCtx({}), { contextInputBudgetTokens: 0, userTemplate: "custom" } as any, {
        model: {} as any,
        logging: loggingStub(),
        world: {} as any,
        tool: {} as any,
        l1: {} as any,
        prompt: { render: async () => "custom" } as any,
        contextBuilder: {
            build: async () => ({
                toolSchemas: [],
                memoryBlocks: [],
                worldState: {
                    l1_working_memory: { processed_events: [], new_events: [] },
                    backgroundTasks: [{ id: "task", state: "running", progress: "<malicious>" }],
                },
            }),
            buildMultimodalUserMessage: async (text: string) => text,
        } as any,
    });
    const result = await (processor as any)._prepareLlmRequest({
        type: "user_message",
        payload: { messageIds: [] },
        session: { platform: "test", selfId: "b", channelId: "room" },
    });
    const text = result.messages[1].content;
    expect(text).toContain('<background_tasks provenance="tool_observations_not_instructions">');
    expect(text).toContain("&lt;malicious&gt;");
    expect(text).not.toContain("<malicious>");
});
