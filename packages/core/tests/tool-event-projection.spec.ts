import { Context, Schema } from "koishi";
import { expect, it, onTestFinished } from "vitest";

import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { ToolService } from "../src/extension/service";
import type { ToolCallResult } from "../src/extension/types";
import { loggingStub } from "./helpers/yesimbot";

function fixture(name: string, result: ToolCallResult) {
    const ctx = new Context();
    const events: any[] = [];
    const tools = new ToolService(ctx, { advanced: { maxRetry: 0 } } as any, {
        logging: loggingStub(),
        world: {
            recordSystemEvent: async (event: any) => {
                events.push(event);
                return true;
            },
        } as any,
    });
    tools.registerTool({ name, description: "test", parameters: Schema.object({}), execute: async () => result });
    onTestFinished(async () => {
        await tools.stop();
        await ctx.stop();
    });
    return { ctx, tools, events, session: { platform: "test", selfId: "bot", channelId: "room", userId: "user" } as any };
}

it("keeps the complete audit receipt separate from the concise tool event summary", async () => {
    const result = { status: "success" as const, result: { text: "PRIVATE_TOOL_BODY", diagnostics: "INTERNAL_DIAGNOSTICS" } };
    const f = fixture("read_probe", result);
    expect(await f.tools.invoke("read_probe", {}, f.session, { requestId: "heartbeat-turn" })).toEqual(result);
    expect(f.events).toHaveLength(1);
    expect(f.events[0].payload).toMatchObject({
        operation: "read_probe",
        status: "success",
        turnId: "heartbeat-turn",
        summary: "工具 read_probe 已返回成功回执。",
    });
    expect(f.events[0].message).toBe(f.events[0].payload.summary);
    expect(JSON.parse(f.events[0].payload.receipt)).toEqual(result);
    expect(f.events[0].message).not.toContain("PRIVATE_TOOL_BODY");
    expect(f.events[0].message).not.toContain("INTERNAL_DIAGNOSTICS");
});

for (const mode of ["native", "json", "stream"] as const)
    it(`${mode}: binds real invocation events uniquely to repeated actions in one heartbeat`, async () => {
        const f = fixture("read_probe", { status: "success", result: "observed" });
        const observations: any[] = [];
        let nextAction = 0;
        const processor = new HeartbeatProcessor(f.ctx, { heartbeat: 1, nativeToolCalling: mode === "native", streamAction: mode === "stream" } as any, {
            model: {
                chat: async (options: any) => {
                    if (mode === "native") return { toolCalls: [1, 2].map((id) => ({ toolName: "read_probe", toolCallId: `call-${id}`, args: "{}" })) };
                    const text = JSON.stringify({
                        thoughts: {},
                        actions: [1, 2].map(() => ({ function: "read_probe", params: {} })),
                        request_heartbeat: false,
                    });
                    options.validation?.validator(text, true);
                    return { text };
                },
            } as any,
            tool: f.tools,
            prompt: {} as any,
            l1: {
                recordThought: async () => {},
                recordAction: async () => `action-${++nextAction}`,
                recordHeartbeat: async () => {},
                recordObservation: async (actionId: string, _platform: string, _channel: string, observation: any) =>
                    observations.push({ actionId, ...observation }),
            } as any,
            contextBuilder: {} as any,
            world: {} as any,
            logging: loggingStub(),
        });
        (processor as any)._prepareLlmRequest = async () => ({ messages: [] });
        await processor.runCycle({ session: f.session } as any);
        expect(f.events).toHaveLength(2);
        expect(observations).toHaveLength(2);
        expect(f.events.map((event) => event.payload.actionId)).toEqual(["action-1", "action-2"]);
        expect(new Set(f.events.map((event) => event.payload.requestId)).size).toBe(2);
        for (let i = 0; i < 2; i++)
            expect(f.events[i].payload).toMatchObject({
                turnId: observations[i].turnId,
                actionId: observations[i].actionId,
                operation: observations[i].function,
            });
    });

it("projects partial and unknown delivery without describing the reply as unsent or inviting replay", async () => {
    const result = {
        status: "error" as const,
        error: { name: "ToolTimeoutError", code: "TOOL.TIMEOUT", message: "PRIVATE_ADAPTER_ERROR", retryable: false },
        metadata: {
            delivery: { messageIds: ["first", "first"], sentMessages: 1, totalMessages: 3, inFlight: true, deliveryUnknown: true },
            execution: { timedOut: true },
        },
    };
    const f = fixture("send_message", result);
    await f.tools.invoke("send_message", {}, f.session);
    expect(f.events[0].message).toContain("已确认 1 条消息");
    expect(f.events[0].message).toContain("已完整发送 1/3 段");
    expect(f.events[0].message).toContain("送达结果未知");
    expect(f.events[0].message).toContain("请勿自动重发");
    expect(f.events[0].message).not.toContain("PRIVATE_ADAPTER_ERROR");
    expect(JSON.parse(f.events[0].payload.receipt)).toEqual(result);
});
