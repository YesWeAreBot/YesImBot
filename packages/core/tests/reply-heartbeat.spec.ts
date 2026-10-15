import { Schema } from "koishi";
import { expect, it } from "vitest";

import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { withReplyTurn } from "../src/agent/reply-turn";
import type { WorldStateService } from "../src/world";
import { loggingStub, stubCtx } from "./helpers/yesimbot";
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
            stubCtx({ logging: { getLogger: () => logger } }),
            { heartbeat: 2, streamAction: mode === "streaming", nativeToolCalling: mode === "native" } as any,
            {
                model: model as any,
                prompt: {} as any,
                tool: {
                    getAvailableTools: () => [{ name: "send_message", description: "test", parameters: Schema.object({}) }],
                    invoke: async () => {
                        calls.push("tool");
                    },
                } as any,
                l1: { recordThought: async () => {}, recordHeartbeat: async () => {} } as any,
                contextBuilder: {} as any,
                logging: loggingStub(logger),
                // 该用例在模型请求被中止后就结束，不会读取 world，仅需一个占位依赖。
                world: {} as unknown as WorldStateService,
            },
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
