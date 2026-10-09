import { Schema } from "koishi";
import { expect, it } from "vitest";

import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { Services } from "../src/shared/constants";

const modelResponse = (message: string) =>
    JSON.stringify({ thoughts: {}, actions: [{ function: "send_message", params: { message } }], request_heartbeat: false });

for (const scenario of ["success", "error", "query", "legacy"]) {
    it(`native heartbeat counts confirmed replies: ${scenario}`, async () => {
        const logger = { debug() {}, info() {}, warn() {}, error() {}, success() {} };
        const name = scenario === "query" ? "lookup" : "send_message";
        const definition = { name, description: "test", parameters: Schema.object({ message: Schema.string() }) };
        const processor = new HeartbeatProcessor(
            { [Services.Logger]: { getLogger: () => logger } } as any,
            { heartbeat: 1, nativeToolCalling: true } as any,
            {
                chat: async () =>
                    scenario === "legacy"
                        ? {
                              text: JSON.stringify({
                                  thoughts: {},
                                  actions: [{ function: "send_message", params: { message: "hello" } }],
                                  request_heartbeat: false,
                              }),
                          }
                        : { toolCalls: [{ toolCallId: "call", toolName: name, args: '{"message":"hello"}' }] },
            } as any,
            {} as any,
            {
                getAvailableTools: () => [definition],
                getTool: () => definition,
                invoke: async () => ({ status: scenario === "error" ? "error" : "success" }),
            } as any,
            {
                recordThought: async () => {},
                recordHeartbeat: async () => {},
                recordAction: async () => "action",
                recordObservation: async () => {},
            } as any,
            {} as any,
        );
        (processor as any)._prepareLlmRequest = async () => ({ messages: [] });
        expect(await processor.runCycle({ session: { platform: "qq", channelId: "group", cid: "qq:group" } } as any)).toBe(
            scenario === "success" || scenario === "legacy",
        );
    });
}

it("does not execute streamed actions when the model fails", async () => {
    const calls: string[] = [];
    const response = JSON.stringify({ thoughts: {}, actions: [{ function: "send_message", params: {} }], request_heartbeat: false });
    const processor = streamingFixture(
        async (options: any) => {
            options.validation.validator(response, false);
            await new Promise((resolve) => setTimeout(resolve, 0));
            throw new Error("model connection lost");
        },
        async (name: string) => {
            calls.push(name);
            return { status: "success" };
        },
    );
    expect(await processor.runCycle(stimulus())).toBe(false);
    expect(calls).toEqual([]);
});

function stimulus(): any {
    return { session: { platform: "qq", channelId: "group", cid: "qq:group" } };
}

function streamingFixture(chat: any, invoke: any): HeartbeatProcessor {
    const logger = { debug() {}, info() {}, warn() {}, error() {}, success() {} };
    const processor = new HeartbeatProcessor(
        { [Services.Logger]: { getLogger: () => logger } } as any,
        { heartbeat: 1, streamAction: true } as any,
        { chat } as any,
        {} as any,
        { invoke } as any,
        { recordThought: async () => {}, recordAction: async () => "action", recordObservation: async () => {} } as any,
        {} as any,
    );
    (processor as any)._prepareLlmRequest = async () => ({ messages: [] });
    return processor;
}

for (const streamAction of [false, true]) {
    for (const status of ["success", "error"]) {
        it(`${streamAction ? "streaming" : "normal"} heartbeat reflects ${status} delivery`, async () => {
            const observations: any[] = [];
            const successfulLogs: string[] = [];
            const logger = { debug() {}, info() {}, warn() {}, error() {}, success: (message: string) => successfulLogs.push(message) };
            const response = JSON.stringify({
                thoughts: { observe: "test", analyze_infer: "test", plan: "test" },
                actions: [{ function: "send_message", params: { message: "hello" } }],
                request_heartbeat: false,
            });
            const processor = new HeartbeatProcessor(
                { [Services.Logger]: { getLogger: () => logger } } as any,
                { heartbeat: 1, streamAction } as any,
                {
                    chat: async (options: any) => {
                        if (options.stream) options.validation.validator(response, true);
                        return { text: response };
                    },
                } as any,
                {} as any,
                {
                    invoke: async () => ({ status, error: status === "error" ? { name: "ToolError", message: "QQ refused" } : undefined }),
                } as any,
                {
                    recordThought: async () => {},
                    recordAction: async () => "action",
                    recordObservation: async (...args: any[]) => observations.push(args[3]),
                } as any,
                {} as any,
            );
            (processor as any)._prepareLlmRequest = async () => ({ messages: [] });
            const success = await processor.runCycle({ session: { platform: "qq", channelId: "group", cid: "qq:group" } } as any);
            expect(success).toBe(status === "success");
            expect(observations[0].status).toBe(status);
            expect(successfulLogs.includes("单次心跳成功完成")).toBe(status === "success");
        });
    }
}

it("executes only the accepted model response after invalid JSON retries", async () => {
    const calls: string[] = [];
    const processor = streamingFixture(
        async (options: any) => {
            options.validation.validator(modelResponse("discard"), false);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(options.validation.validator("{invalid", true).valid).toBe(false);
            options.validation.validator(modelResponse("accepted"), true);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(calls).toEqual([]);
            return { text: modelResponse("accepted") };
        },
        async (_name: string, params: any) => {
            calls.push(params.message);
            return { status: "success" };
        },
    );
    expect(await processor.runCycle(stimulus())).toBe(true);
    expect(calls).toEqual(["accepted"]);
});

it("rejects structurally invalid final responses before any action", async () => {
    const calls: string[] = [];
    let accepted: boolean | undefined;
    const response = JSON.stringify({ thoughts: [], actions: [{ function: "send_message", params: {} }] });
    const processor = streamingFixture(
        async (options: any) => {
            accepted = options.validation.validator(response, true).valid;
            throw new Error("all model attempts rejected");
        },
        async (name: string) => {
            calls.push(name);
            return { status: "success" };
        },
    );
    expect(await processor.runCycle(stimulus())).toBe(false);
    expect(calls).toEqual([]);
    expect(accepted).toBe(false);
});

it("does not replay actions when an accepted response has a tool failure", async () => {
    let requests = 0;
    const calls: string[] = [];
    const response = JSON.stringify({
        thoughts: {},
        actions: [
            { function: "send_message", params: {} },
            { function: "lookup", params: {} },
        ],
        request_heartbeat: false,
    });
    const processor = streamingFixture(
        async (options: any) => {
            requests++;
            options.validation.validator(response, true);
            return { text: response };
        },
        async (name: string) => {
            calls.push(name);
            if (name === "lookup") throw new Error("tool failed");
            return { status: "success" };
        },
    );
    expect(await processor.runCycle(stimulus())).toBe(true);
    expect(requests).toBe(1);
    expect(calls).toEqual(["send_message", "lookup"]);
});

for (const streamAction of [false, true]) {
    for (const turns of [
        [{ actions: [], want: false }],
        [{ actions: [{ function: "lookup", status: "success" }], want: false }],
        [{ actions: [{ function: "send_message", status: "error" }] }, { actions: [], want: false }],
        [{ actions: [{ function: "send_message", status: "error" }] }, { actions: [{ function: "send_message", status: "success" }], want: true }],
        [{ actions: [{ function: "send_message", status: "success" }] }, { actions: [{ function: "send_message", status: "error" }], want: true }],
    ]) {
        it(`${streamAction ? "streaming" : "normal"} cycle counts only confirmed replies: ${JSON.stringify(turns)}`, async () => {
            let turn = 0;
            const observations: any[] = [];
            const logger = { debug() {}, info() {}, warn() {}, error() {}, success() {} };
            const processor = new HeartbeatProcessor(
                { [Services.Logger]: { getLogger: () => logger } } as any,
                { heartbeat: turns.length, streamAction } as any,
                {
                    chat: async (options: any) => {
                        const current = turns[turn++];
                        const text = JSON.stringify({
                            thoughts: { observe: "test", analyze_infer: "test", plan: "test" },
                            actions: current.actions.map((action) => ({ function: action.function, params: { status: action.status } })),
                            request_heartbeat: turn < turns.length,
                        });
                        if (options.stream) options.validation.validator(text, true);
                        return { text };
                    },
                } as any,
                {} as any,
                { invoke: async (_name: string, params: any) => ({ status: params.status }) } as any,
                {
                    recordThought: async () => {},
                    recordHeartbeat: async () => {},
                    recordAction: async () => "action",
                    recordObservation: async (...args: any[]) => observations.push(args[3]),
                } as any,
                {} as any,
            );
            (processor as any)._prepareLlmRequest = async () => ({ messages: [] });
            expect(await processor.runCycle({ session: { platform: "qq", channelId: "group", cid: "qq:group" } } as any)).toBe(turns[turns.length - 1].want);
            expect(observations.length).toBe(turns.reduce((count, item) => count + item.actions.length, 0));
        });
    }
}

it("uses only the successful model after a transport failure switches providers", async () => {
    const calls: string[] = [];
    const processor = streamingFixture(
        async (options: any) => {
            options.validation.validator(modelResponse("failed provider"), false);
            await new Promise((resolve) => setTimeout(resolve, 0));
            // 模型切换可能没有经过失败批次的 final 校验回调。
            options.validation.validator(modelResponse("fallback"), true);
            return { text: modelResponse("fallback") };
        },
        async (_name: string, params: any) => {
            calls.push(params.message);
            return { status: "success" };
        },
    );
    expect(await processor.runCycle(stimulus())).toBe(true);
    expect(calls).toEqual(["fallback"]);
});

it("waits for delivery started after final validation before ending the cycle", async () => {
    let release!: () => void;
    let started!: () => void;
    const delivery = new Promise<void>((resolve) => {
        release = resolve;
    });
    const sending = new Promise<void>((resolve) => {
        started = resolve;
    });
    const response = JSON.stringify({ thoughts: {}, actions: [{ function: "send_message", params: {} }], request_heartbeat: false });
    const processor = streamingFixture(
        async (options: any) => {
            options.validation.validator(response, true);
            return { text: response };
        },
        async () => {
            started();
            await delivery;
            return { status: "success" };
        },
    );
    let settled = false;
    const cycle = processor.runCycle(stimulus()).then((value) => {
        settled = true;
        return value;
    });
    await sending;
    expect(settled).toBe(false);
    release();
    expect(await cycle).toBe(true);
});

it("closes every parser stream after malformed partial actions and a transport failure", async () => {
    const calls: string[] = [];
    const processor = streamingFixture(
        async (options: any) => {
            options.validation.validator(JSON.stringify({ thoughts: {}, actions: [null, { function: "send_message", params: {} }] }), false);
            await new Promise((resolve) => setTimeout(resolve, 0));
            throw new Error("transport failed");
        },
        async (name: string) => {
            calls.push(name);
            return { status: "success" };
        },
    );
    let timer: ReturnType<typeof setTimeout>;
    try {
        const result = await Promise.race([
            processor.runCycle(stimulus()),
            new Promise((resolve) => {
                timer = setTimeout(() => resolve("timeout"), 100);
            }),
        ]);
        expect(result).toBe(false);
        expect(calls).toEqual([]);
    } finally {
        clearTimeout(timer!);
    }
});

for (const topLevel of [undefined, false]) {
    it(`streaming heartbeat preserves nested compatibility and top-level ${String(topLevel)} priority`, async () => {
        const response = JSON.stringify({
            thoughts: { request_heartbeat: true },
            actions: [],
            ...(topLevel === undefined ? {} : { request_heartbeat: topLevel }),
        });
        const processor = streamingFixture(
            async (options: any) => {
                options.validation.validator(response, true);
                return { text: response };
            },
            async () => ({ status: "success" }),
        );
        const result = await (processor as any).performSingleHeartbeatWithStreaming("turn", stimulus(), () => {});
        expect(result.continue).toBe(topLevel ?? true);
        expect(result.replySent).toBe(false);
    });
}
