import { Schema } from "koishi";
import { expect, it, vi } from "vitest";

import { AgentBehaviorConfigSchema } from "../src/agent/config";
import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { withReplyTurnGuard } from "../src/agent/reply-turn";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

const call = (toolName: string, args: unknown, toolCallId = "call") => ({ toolCallId, toolCallType: "function", toolName, args: JSON.stringify(args) });
function setup(responses: any[], config: Record<string, unknown> = {}) {
    const logger = {
        debug: vi.fn<(...args: any[]) => void>(),
        info: vi.fn<(...args: any[]) => void>(),
        warn: vi.fn<(...args: any[]) => void>(),
        error: vi.fn<(...args: any[]) => void>(),
        success: vi.fn<(...args: any[]) => void>(),
    };
    const requests: any[] = [];
    const invoke = vi.fn<(...args: any[]) => Promise<any>>(async () => ({ status: "success" }));
    const definitions = [
        { name: "send_message", description: "send", parameters: Schema.object({ message: Schema.string().required() }) },
        { name: "lookup", description: "lookup", parameters: Schema.object({ action: Schema.string().required() }) },
    ];
    const processor = new HeartbeatProcessor(stubCtx({ logging: { getLogger: () => logger } }), { heartbeat: 1, nativeToolCalling: true, ...config } as any, {
        model: {
            chat: async (options: any) => {
                requests.push(structuredClone(options.messages));
                const response = responses[Math.min(requests.length - 1, responses.length - 1)];
                if (response instanceof Error) throw response;
                if (typeof response === "function") return response();
                return response;
            },
        } as any,
        prompt: {} as any,
        tool: { getAvailableTools: () => definitions, getTool: (name) => definitions.find((tool) => tool.name === name), invoke } as any,
        l1: { recordThought: async () => {}, recordHeartbeat: async () => {}, recordAction: async () => "action", recordObservation: async () => {} } as any,
        contextBuilder: {} as any,
        logging: loggingStub(logger),
        world: {} as any,
    });
    (processor as any)._prepareLlmRequest = async () => ({ messages: [] });
    const run = () => processor.runCycle({ session: { platform: "qq", channelId: "g", cid: "qq:g" } } as any);
    return { requests, invoke, logger, run };
}
it("feeds invalid argument paths back as paired tool responses before any batch action executes", async () => {
    const f = setup([
        { toolCalls: [call("send_message", { message: "discard" }, "send"), call("lookup", {}, "lookup")] },
        { toolCalls: [call("send_message", { message: "accepted" }, "corrected")] },
    ]);
    expect(await f.run()).toBe(true);
    expect(f.invoke.mock.calls).toEqual([["send_message", { message: "accepted" }, expect.anything(), expect.objectContaining({ attachedImageIds: [] })]]);
    const repair = f.requests[1];
    expect(repair.find((message) => message.role === "assistant").tool_calls).toHaveLength(2);
    const results = repair.filter((message) => message.role === "tool");
    expect(results.map((message) => message.tool_call_id)).toEqual(["send", "lookup"]);
    expect(results[1].content).toContain("action");
    expect(f.logger.error).not.toHaveBeenCalled();
});
it("does not execute tool tags written into plain text and asks for a native correction", async () => {
    const f = setup([
        { text: '<tool_call>{"function":"send_message","params":{"message":"discard"}}</tool_call>' },
        { toolCalls: [call("send_message", { message: "accepted" })] },
    ]);
    expect(await f.run()).toBe(true);
    expect(f.requests).toHaveLength(2);
    expect(f.invoke.mock.calls[0][1]).toEqual({ message: "accepted" });
    expect(f.logger.error).not.toHaveBeenCalled();
});
it("bounds malformed response correction and reports the classified failure only once", async () => {
    const f = setup([{ toolCalls: [call("lookup", { secret: "DO_NOT_LOG" })] }]);
    expect(await f.run()).toBe(false);
    expect(f.requests).toHaveLength(2);
    expect(f.invoke).not.toHaveBeenCalled();
    const errors = f.logger.error.mock.calls.flat().join("\n");
    expect(errors.match(/错误报告/g)).toHaveLength(1);
    expect(errors).toContain("LLM.OUTPUT_PARSING_FAILED");
    expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain("DO_NOT_LOG");
});
it("does not retry or replay a batch after actual execution has started", async () => {
    const f = setup([{ toolCalls: [call("send_message", { message: "once" }), call("lookup", { action: "read" }, "lookup")] }]);
    f.invoke.mockImplementationOnce(async () => ({ status: "success" })).mockImplementationOnce(async () => ({ status: "error" }));
    expect(await f.run()).toBe(true);
    expect(f.requests).toHaveLength(1);
    expect(f.invoke).toHaveBeenCalledTimes(2);
});
it("preserves successful legacy JSON responses without a native retry", async () => {
    const f = setup([
        { text: JSON.stringify({ thoughts: {}, actions: [{ function: "send_message", params: { message: "legacy" } }], request_heartbeat: false }) },
    ]);
    expect(await f.run()).toBe(true);
    expect(f.requests).toHaveLength(1);
});

it("does not retry transport errors as model argument corrections", async () => {
    const f = setup([new Error("transport failed")]);
    expect(await f.run()).toBe(false);
    expect(f.requests).toHaveLength(1);
    expect(f.invoke).not.toHaveBeenCalled();
});
it.each(["invalid-json", "conflicting-id"])("corrects %s without executing the original batch", async (scenario) => {
    const original =
        scenario === "invalid-json"
            ? [{ ...call("lookup", {}), args: "{invalid" }]
            : [call("send_message", { message: "discard" }), call("lookup", { action: "read" })];
    const f = setup([{ toolCalls: original }, { toolCalls: [call("send_message", { message: "accepted" }, "fixed")] }]);
    expect(await f.run()).toBe(true);
    expect(f.invoke).toHaveBeenCalledTimes(1);
    expect(f.invoke.mock.calls[0][1]).toEqual({ message: "accepted" });
});

it("preserves opaque tool identifiers and assistant reasoning metadata during correction", async () => {
    const id = "yib-qwen:opaque/+==:continuation";
    const f = setup([
        {
            toolCalls: [call("lookup", {}, id)],
            messages: [
                {
                    role: "assistant",
                    content: "",
                    reasoning_content: "retained provider reasoning",
                    tool_calls: [{ id, type: "function", function: { name: "lookup", arguments: "{}" } }],
                },
            ],
        },
        { toolCalls: [call("send_message", { message: "accepted" })] },
    ]);
    expect(await f.run()).toBe(true);
    expect(f.requests[1].find((message) => message.role === "assistant").reasoning_content).toBe("retained provider reasoning");
    expect(f.requests[1].find((message) => message.role === "tool").tool_call_id).toBe(id);
});

it("does not issue correction requests after the reply turn is cancelled", async () => {
    const controller = new AbortController();
    const f = setup([
        () => {
            controller.abort();
            return { toolCalls: [call("lookup", {})] };
        },
    ]);
    expect(await withReplyTurnGuard(() => !controller.signal.aborted, f.run, controller.signal)).toBe(false);
    expect(f.requests).toHaveLength(1);
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.logger.error).not.toHaveBeenCalled();
});

it("does not unwrap tool markup into an otherwise valid legacy action batch", async () => {
    const legacy = JSON.stringify({ thoughts: {}, actions: [{ function: "send_message", params: { message: "discard" } }], request_heartbeat: false });
    const f = setup([{ text: `<tool_call>${legacy}</tool_call>` }, { toolCalls: [call("send_message", { message: "accepted" })] }]);
    expect(await f.run()).toBe(true);
    expect(f.requests).toHaveLength(2);
    expect(f.invoke.mock.calls[0][1]).toEqual({ message: "accepted" });
});

it("allows literal tool tag text inside a valid legacy JSON message", async () => {
    const f = setup([
        {
            text: JSON.stringify({
                thoughts: {},
                actions: [{ function: "send_message", params: { message: "literal <tool_call> text" } }],
                request_heartbeat: false,
            }),
        },
    ]);
    expect(await f.run()).toBe(true);
    expect(f.requests).toHaveLength(1);
    expect(f.invoke.mock.calls[0][1]).toEqual({ message: "literal <tool_call> text" });
});

it.each([0, 2, 4])("stops after the configured %i additional argument corrections", async (retries) => {
    const f = setup([{ toolCalls: [call("lookup", {})] }], { nativeToolCorrectionRetries: retries });
    expect(await f.run()).toBe(false);
    expect(f.requests).toHaveLength(retries + 1);
    expect(f.invoke).not.toHaveBeenCalled();
});

it.each([0, 2])("stops after the configured %i additional plain-text corrections", async (retries) => {
    const f = setup([{ text: "invalid plain text" }], { nativeToolCorrectionRetries: retries });
    expect(await f.run()).toBe(false);
    expect(f.requests).toHaveLength(retries + 1);
    expect(f.invoke).not.toHaveBeenCalled();
});

it("executes only the successful batch after multiple corrections", async () => {
    const f = setup(
        [
            { toolCalls: [call("lookup", {}, "first")] },
            { toolCalls: [call("lookup", {}, "second")] },
            { toolCalls: [call("send_message", { message: "accepted" }, "third")] },
        ],
        { nativeToolCorrectionRetries: 2 },
    );
    expect(await f.run()).toBe(true);
    expect(f.requests).toHaveLength(3);
    expect(f.invoke.mock.calls).toEqual([["send_message", { message: "accepted" }, expect.anything(), expect.objectContaining({ attachedImageIds: [] })]]);
    expect(f.requests[2].filter((message) => message.role === "tool").map((message) => message.tool_call_id)).toEqual(["first", "second"]);
});

it("defaults correction retries to one and accepts only non-negative safe integers", () => {
    expect(AgentBehaviorConfigSchema({}).nativeToolCorrectionRetries).toBe(1);
    for (const value of [0, 2, 20]) expect(AgentBehaviorConfigSchema({ nativeToolCorrectionRetries: value }).nativeToolCorrectionRetries).toBe(value);
    for (const value of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => AgentBehaviorConfigSchema({ nativeToolCorrectionRetries: value })).toThrow();
    }
});
