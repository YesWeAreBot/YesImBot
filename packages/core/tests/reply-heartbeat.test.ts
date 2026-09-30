import { expect, it } from "bun:test";
import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { withReplyTurn } from "../src/agent/reply-turn";
import { Services } from "../src/shared/constants";
for (const streamAction of [false, true])
    it(`cancels an in-flight ${streamAction ? "streaming" : "normal"} model request and stops all actions`, async () => {
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
            { heartbeat: 2, streamAction } as any,
            model as any,
            {} as any,
            {
                invoke: async () => {
                    calls.push("tool");
                },
            } as any,
            { recordThought: async () => {}, recordHeartbeat: async () => {} } as any,
            {} as any
        );
        (processor as any)._prepareLlmRequest = async () => ({ messages: [] });
        const result = withReplyTurn(
            () => !controller.signal.aborted,
            () => processor.runCycle({ session: { platform: "onebot", channelId: "g" } } as any),
            controller.signal
        );
        await started;
        controller.abort();
        expect(await result).toBe(false);
        expect(calls).toEqual([]);
    });
