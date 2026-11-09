import { Schema } from "koishi";
import { expect, it } from "vitest";

import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { ToolService } from "../src/extension/service";
import { loggingStub } from "./helpers/yesimbot";

const params = (name: string) => (name === "conversation_read" ? { message_id: "source" } : {});

function setup(mode: "native" | "json" | "stream", batches: string[][], heartbeat = 3, actionParams = params) {
    const ctx: any = { filter: () => true, on() {}, logger: () => ({ warn() {} }) };
    const tools = new ToolService(ctx, { advanced: { maxRetry: 0 } } as any, { logging: loggingStub() } as any);
    const observations: any[] = [],
        invoked: string[] = [],
        seen: any[] = [];
    for (const name of ["read", "send_message"])
        tools.registerTool({
            name,
            description: name,
            parameters: Schema.object({}),
            readOnly: name === "read",
            execute: async () => {
                invoked.push(name);
                return name === "read"
                    ? { status: "error", error: { name: "ToolTimeoutError", code: "TOOL.TIMEOUT", message: "read timeout", retryable: false } }
                    : { status: "success", metadata: { delivery: { messageIds: ["sent"] } } };
            },
        });
    let modelCalls = 0;
    const processor = new HeartbeatProcessor(ctx, { heartbeat, nativeToolCalling: mode === "native", streamAction: mode === "stream" } as any, {
        model: {
            chat: async (options: any) => {
                seen.push(JSON.parse(options.messages[0].content));
                const names = batches[Math.min(modelCalls++, batches.length - 1)];
                if (mode === "native")
                    return {
                        toolCalls: names.map((name, index) => ({
                            toolName: name,
                            toolCallId: `call-${modelCalls}-${index}`,
                            args: JSON.stringify(actionParams(name)),
                        })),
                    };
                const text = JSON.stringify({
                    thoughts: {},
                    actions: names.map((name) => ({ function: name, params: actionParams(name) })),
                    request_heartbeat: false,
                });
                options.validation?.validator(text, true);
                return { text };
            },
        } as any,
        tool: tools,
        prompt: {} as any,
        l1: {
            recordThought: async () => {},
            recordAction: async () => "action",
            recordObservation: async (...args: any[]) => observations.push(args[3]),
            recordHeartbeat: async () => {},
        } as any,
        contextBuilder: {} as any,
        world: {} as any,
        logging: loggingStub(),
    });
    (processor as any)._prepareLlmRequest = async () => ({ messages: [{ role: "user", content: JSON.stringify(observations) }] });
    return {
        run: async () => {
            try {
                return await processor.runCycle({ session: { platform: "test", channelId: "group" } } as any);
            } finally {
                await tools.stop();
            }
        },
        tools,
        ctx,
        invoked,
        observations,
        seen,
        modelCalls: () => modelCalls,
    };
}

for (const mode of ["native", "json", "stream"] as const) {
    for (const action of ["list", "propose"] as const) {
        it(`${mode}: mixed person_memory ${action} recovers only for the pure read action`, async () => {
            const f = setup(mode, [["person_memory", "send_message"], ["send_message"]], 3, (name) => (name === "person_memory" ? { action } : {}));
            let attempts = 0;
            f.tools.registerTool({
                name: "person_memory",
                description: "mixed read/write",
                parameters: Schema.object({ action: Schema.string().required() }),
                readOnly: (args: Record<string, unknown>) => args.action === "list",
                execute: async () => {
                    attempts++;
                    return { status: "error", error: { name: "PersonMemoryError", message: "invalid request", retryable: false } };
                },
            } as any);
            expect(await f.run()).toBe(action === "list");
            expect(attempts).toBe(1);
            expect(f.modelCalls()).toBe(action === "list" ? 2 : 1);
            expect(f.invoked).toEqual(action === "list" ? ["send_message"] : []);
        });
    }
    it(`${mode}: a failed read skips dependent sends and gives its structured observation to the next bounded decision`, async () => {
        const f = setup(mode, [["read", "send_message"], ["send_message"]]);
        expect(await f.run()).toBe(true);
        expect(f.invoked).toEqual(["read", "send_message"]);
        expect(f.modelCalls()).toBe(2);
        expect(f.seen[1][0]).toMatchObject({ function: "read", status: "error", error: { code: "TOOL.TIMEOUT" } });
    });
    it(`${mode}: continuous failed reads stop at the heartbeat limit without counting a reply`, async () => {
        const f = setup(mode, [["read"]], 3);
        expect(await f.run()).toBe(false);
        expect(f.modelCalls()).toBe(3);
        expect(f.invoked).toEqual(["read", "read", "read"]);
    });
    it(`${mode}: a failed read after a confirmed send ends the cycle without replaying the send`, async () => {
        const f = setup(mode, [["send_message", "read"], ["send_message"]]);
        expect(await f.run()).toBe(true);
        expect(f.invoked).toEqual(["send_message", "read"]);
        expect(f.modelCalls()).toBe(1);
    });
}

for (const mode of ["native", "json", "stream"] as const) {
    it(`${mode}: real builtin conversation_read failures recover through the next heartbeat`, async () => {
        const { default: MemoryExtension } = await import("../src/extension/builtin/memory");
        const f = setup(mode, [["conversation_read", "send_message"], ["send_message"]]);
        let reads = 0;
        f.ctx.yesimbot = {
            tool: f.tools,
            world: {
                readMessageWindow: async () => {
                    reads++;
                    throw new Error("history unavailable");
                },
            },
        };
        const extension = new MemoryExtension(f.ctx, {});
        for (const definition of (extension as any).tools.values()) f.tools.registerTool(definition);
        expect(f.tools.getTool("conversation_read")?.readOnly).toBe(true);
        expect(f.tools.getTool("conversation_search")?.readOnly).toBe(true);
        expect(f.tools.getTool("conversation_state_read")?.readOnly).toBe(true);
        expect(f.tools.getTool("memory_recall")?.readOnly).toBeUndefined();
        expect(await f.run()).toBe(true);
        expect(reads).toBe(1);
        expect(f.invoked).toEqual(["send_message"]);
        expect(f.modelCalls()).toBe(2);
        expect(f.seen[1][0]).toMatchObject({ function: "conversation_read", status: "error" });
        expect(f.seen[1][0].error.message).toContain("history unavailable");
    });
}
