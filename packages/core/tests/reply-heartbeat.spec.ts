import { Schema } from "koishi";
import { expect, it } from "vitest";

import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { withReplyTurn } from "../src/agent/reply-turn";
import { Services } from "../src/shared/constants";
for (const mode of ["normal", "streaming", "native"])
    it(`cancels an in-flight ${mode} model request and stops all actions`, async () => {
        const controller = new AbortController();
        let ready!: () => void;
        const started = new Promise<void>((r) => {
            ready = r;
        });
        const calls: string[] = [];
        const logger = { debug() {}, info() {}, warn() {}, error() {}, success() {} };
        const model = {
            chat: (options: any) =>
                new Promise((_, reject) => {
                    expect(options.abortSignal).toBe(controller.signal);
                    options.abortSignal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
                    ready();
                }),
        };
        const processor = new HeartbeatProcessor(
            { [Services.Logger]: { getLogger: () => logger } } as any,
            { heartbeat: 2, streamAction: mode === "streaming", nativeToolCalling: mode === "native" } as any,
            model as any,
            {} as any,
            {
                getAvailableTools: () => [{ name: "send_message", description: "test", parameters: Schema.object({}) }],
                invoke: async () => {
                    calls.push("tool");
                },
            } as any,
            { recordThought: async () => {}, recordHeartbeat: async () => {} } as any,
            {} as any,
        );
        (processor as any)._prepareLlmRequest = async () => ({ messages: [] });
        const result = withReplyTurn(
            () => !controller.signal.aborted,
            () => processor.runCycle({ session: { platform: "onebot", channelId: "g" } } as any),
            controller.signal,
        );
        await started;
        controller.abort();
        expect(await result).toBe(false);
        expect(calls).toEqual([]);
    });

for (const mode of ["normal", "streaming", "native"])
    it(`discards a late ${mode} model response after cancellation without reporting a fault`, async () => {
        const controller = new AbortController();
        const writes: string[] = [];
        const errors: any[] = [];
        const logger = { debug() {}, info() {}, warn() {}, success() {}, error: (...args: any[]) => errors.push(args) };
        const processor = new HeartbeatProcessor(
            { [Services.Logger]: { getLogger: () => logger } } as any,
            { heartbeat: 2, streamAction: mode === "streaming", nativeToolCalling: mode === "native" } as any,
            {
                chat: async () => {
                    controller.abort();
                    return { text: JSON.stringify({ thoughts: {}, actions: [{ function: "probe", params: {} }], request_heartbeat: true }) };
                },
            } as any,
            {} as any,
            {
                getAvailableTools: () => [{ name: "probe", description: "test", parameters: Schema.object({}) }],
                invoke: async () => {
                    writes.push("tool");
                    return { status: "success" };
                },
            } as any,
            {
                recordThought: async () => {
                    writes.push("thought");
                },
                recordAction: async () => {
                    writes.push("action");
                    return "id";
                },
                recordHeartbeat: async () => {
                    writes.push("heartbeat");
                },
            } as any,
            {} as any,
        );
        (processor as any)._prepareLlmRequest = async () => ({ messages: [], manualRecallIds: [] });
        expect(
            await withReplyTurn(
                () => !controller.signal.aborted,
                () => processor.runCycle({ session: { platform: "onebot", channelId: "g" } } as any),
                controller.signal,
            ),
        ).toBe(false);
        expect(writes).toEqual([]);
        expect(errors).toEqual([]);
    });

for (const mode of ["normal", "streaming", "native"])
    it(`stops a ${mode} heartbeat when cancellation races with a tool receipt`, async () => {
        const controller = new AbortController();
        const calls: string[] = [];
        const observations: any[] = [];
        const logger = { debug() {}, info() {}, warn() {}, success() {}, error() {} };
        const definition = { name: "probe", description: "test", parameters: Schema.object({}) };
        const processor = new HeartbeatProcessor(
            { [Services.Logger]: { getLogger: () => logger } } as any,
            { heartbeat: 2, streamAction: mode === "streaming", nativeToolCalling: mode === "native" } as any,
            {
                chat: async () => ({
                    text: JSON.stringify({
                        thoughts: {},
                        actions: [
                            { function: "probe", params: {} },
                            { function: "send_message", params: {} },
                        ],
                        request_heartbeat: true,
                    }),
                    ...(mode === "native"
                        ? {
                              toolCalls: [
                                  { toolCallId: "one", toolName: "probe", args: "{}" },
                                  { toolCallId: "two", toolName: "send_message", args: "{}" },
                              ],
                          }
                        : {}),
                }),
            } as any,
            {} as any,
            {
                getAvailableTools: () => [definition],
                getTool: () => definition,
                invoke: async (name: string) => {
                    calls.push(name);
                    controller.abort();
                    return { status: "success" };
                },
            } as any,
            {
                recordThought: async () => {},
                recordAction: async () => "id",
                recordHeartbeat: async () => {},
                recordObservation: async (...args: any[]) => {
                    observations.push(args);
                },
            } as any,
            {} as any,
        );
        (processor as any)._prepareLlmRequest = async () => ({ messages: [], manualRecallIds: [] });
        expect(
            await withReplyTurn(
                () => !controller.signal.aborted,
                () => processor.runCycle({ session: { platform: "onebot", channelId: "g" } } as any),
                controller.signal,
            ),
        ).toBe(false);
        expect(calls).toEqual(["probe"]);
        expect(observations).toEqual([]);
    });
