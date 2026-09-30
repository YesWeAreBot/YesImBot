import { expect, it } from "bun:test";
import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { Services } from "../src/shared/constants";

it("waits for an in-flight streaming reply when the model fails and preserves its success", async () => {
    let release!: () => void;
    let started!: () => void;
    const delivery = new Promise<void>((resolve) => {
        release = resolve;
    });
    const sending = new Promise<void>((resolve) => {
        started = resolve;
    });
    const logger = { debug() {}, info() {}, warn() {}, error() {}, success() {} };
    const response = JSON.stringify({
        thoughts: { observe: "test", analyze_infer: "test", plan: "test" },
        actions: [{ function: "send_message", params: {} }],
        request_heartbeat: false,
    });
    const processor = new HeartbeatProcessor(
        { [Services.Logger]: { getLogger: () => logger } } as any,
        { heartbeat: 1, streamAction: true } as any,
        {
            chat: async (options: any) => {
                options.validation.validator(response, false);
                await sending;
                throw new Error("model connection lost");
            },
        } as any,
        {} as any,
        {
            invoke: async () => {
                started();
                await delivery;
                return { status: "success" };
            },
        } as any,
        { recordThought: async () => {}, recordAction: async () => "action", recordObservation: async () => {} } as any,
        {} as any
    );
    (processor as any)._prepareLlmRequest = async () => ({ messages: [] });
    let settled = false;
    const result = processor.runCycle({ session: { platform: "qq", channelId: "group", cid: "qq:group" } } as any).then((value) => {
        settled = true;
        return value;
    });
    await sending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    release();
    expect(await result).toBe(true);
});

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
                {} as any
            );
            (processor as any)._prepareLlmRequest = async () => ({ messages: [] });
            const success = await processor.runCycle({ session: { platform: "qq", channelId: "group", cid: "qq:group" } } as any);
            expect(success).toBe(status === "success");
            expect(observations[0].status).toBe(status);
            expect(successfulLogs.includes("单次心跳成功完成")).toBe(status === "success");
        });
    }
}

it("counts a reply started by an earlier streaming batch after a model retry", async () => {
    let release!: () => void;
    let started!: () => void;
    let retried!: () => void;
    const delivery = new Promise<void>((resolve) => {
        release = resolve;
    });
    const sending = new Promise<void>((resolve) => {
        started = resolve;
    });
    const retryComplete = new Promise<void>((resolve) => {
        retried = resolve;
    });
    const logger = { debug() {}, info() {}, warn() {}, error() {}, success() {} };
    const first = JSON.stringify({
        thoughts: { observe: "test", analyze_infer: "test", plan: "test" },
        actions: [{ function: "send_message", params: {} }],
        request_heartbeat: false,
    });
    const second = JSON.stringify({
        thoughts: { observe: "retry", analyze_infer: "retry", plan: "retry" },
        actions: [],
        request_heartbeat: false,
    });
    const processor = new HeartbeatProcessor(
        { [Services.Logger]: { getLogger: () => logger } } as any,
        { heartbeat: 1, streamAction: true } as any,
        {
            chat: async (options: any) => {
                options.validation.validator(first, false);
                await sending;
                options.validation.validator("{invalid", true);
                options.validation.validator(second, true);
                retried();
                return { text: second };
            },
        } as any,
        {} as any,
        {
            invoke: async () => {
                started();
                await delivery;
                return { status: "success" };
            },
        } as any,
        { recordThought: async () => {}, recordAction: async () => "action", recordObservation: async () => {} } as any,
        {} as any
    );
    (processor as any)._prepareLlmRequest = async () => ({ messages: [] });
    let settled = false;
    const result = processor.runCycle({ session: { platform: "qq", channelId: "group", cid: "qq:group" } } as any).then((value) => {
        settled = true;
        return value;
    });
    await retryComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    release();
    expect(await result).toBe(true);
});

for (const streamAction of [false, true]) {
    for (const turns of [
        [{ actions: [], want: false }],
        [{ actions: [{ function: "lookup", status: "success" }], want: false }],
        [{ actions: [{ function: "send_message", status: "error" }] }, { actions: [], want: false }],
        [
            { actions: [{ function: "send_message", status: "error" }] },
            { actions: [{ function: "send_message", status: "success" }], want: true },
        ],
        [
            { actions: [{ function: "send_message", status: "success" }] },
            { actions: [{ function: "send_message", status: "error" }], want: true },
        ],
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
                {} as any
            );
            (processor as any)._prepareLlmRequest = async () => ({ messages: [] });
            expect(await processor.runCycle({ session: { platform: "qq", channelId: "group", cid: "qq:group" } } as any)).toBe(
                turns[turns.length - 1].want
            );
            expect(observations.length).toBe(turns.reduce((count, item) => count + item.actions.length, 0));
        });
    }
}
