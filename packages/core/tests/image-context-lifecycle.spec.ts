import { h } from "koishi";
import { expect, it, vi } from "vitest";

import { PromptContextBuilder } from "../src/agent/context-builder";
import { loggingStub } from "./helpers/yesimbot";

function state(channel = "A", source = "msg", quoted = false, selfId = "bot") {
    const image = { type: "message", id: source, elements: h.parse('<img id="img"/>'), timestamp: new Date() };
    return {
        channel: { platform: "test", id: channel, type: "guild" },
        self: { id: selfId },
        l1_working_memory: {
            processed_events: [],
            new_events: [image, ...(quoted ? [{ type: "message", id: "quote", quoteId: source, elements: [], timestamp: new Date() }] : [])],
        },
    } as any;
}
function setup() {
    const asset = {
        getInfo: vi.fn<(id: string) => Promise<{ id: string; mime: string } | undefined>>().mockResolvedValue({ id: "img", mime: "image/png" }),
        read: vi.fn<(id: string) => Promise<string>>().mockResolvedValue("data:image/jpeg;base64,eA=="),
    };
    const builder = new PromptContextBuilder(
        {} as any,
        { enableVision: true, maxImagesInContext: 3, imageLifecycleCount: 1, allowedImageTypes: ["image/png"], detail: "low" } as any,
        { model: { hasVisionCapability: () => true }, logging: loggingStub({ debug() {} }), asset, memory: {}, tool: {}, world: {} } as any,
    );
    const build = (world = state()) => builder.buildMultimodalUserMessage("prompt", world);
    const commit = (content: any) => (builder as any).commitMultimodalUsage([{ role: "user", content }]);
    return { asset, builder, build, commit };
}
it("does not consume the allowance before a successful model request", async () => {
    const f = setup();
    const first = await f.build();
    expect(Array.isArray(first)).toBe(true);
    expect(Array.isArray(await f.build())).toBe(true);
    f.commit(first);
    f.commit(first);
    expect(await f.build()).toBe("prompt");
});
it("does not consume allowance after missing resource metadata", async () => {
    const f = setup();
    f.asset.getInfo.mockResolvedValueOnce(undefined);
    expect(await f.build()).toBe("prompt");
    expect(Array.isArray(await f.build())).toBe(true);
});
it("does not consume allowance after resource read failure", async () => {
    const f = setup();
    f.asset.read.mockRejectedValueOnce(new Error("unavailable"));
    await expect(f.build()).rejects.toThrow("unavailable");
    expect(Array.isArray(await f.build())).toBe(true);
});
it("allows quoted source images after the allowance is exhausted", async () => {
    const f = setup();
    f.commit(await f.build());
    expect(Array.isArray(await f.build(state("A", "msg", true)))).toBe(true);
});
it.each([state("B"), state("A", "new-message"), state("A", "msg", false, "other-bot")])(
    "isolates the allowance by conversation, bot and source occurrence",
    async (other) => {
        const f = setup();
        f.commit(await f.build());
        expect(Array.isArray(await f.build(other))).toBe(true);
    },
);

it.each(["performSingleHeartbeat", "performSingleHeartbeatWithStreaming", "performNativeHeartbeat"])(
    "settles image usage only on model success in %s",
    async (method) => {
        const { HeartbeatProcessor } = await import("../src/agent/heartbeat-processor");
        const { Schema } = await import("koishi");
        const f = setup();
        let fail = true;
        const processor = new HeartbeatProcessor(
            {} as any,
            {} as any,
            {
                contextBuilder: f.builder,
                model: {
                    chat: async () => {
                        if (fail) throw new Error("upstream failed");
                        return { text: "{}", toolCalls: [], usage: {} };
                    },
                },
                logging: loggingStub({ debug() {}, info() {}, warn() {}, error() {}, success() {} }),
                tool: { getAvailableTools: () => [{ name: "noop", description: "noop", parameters: Schema.object({}) }] },
                l1: { recordThought: async () => {} },
                prompt: {},
                world: {},
            } as any,
        );
        (processor as any)._prepareLlmRequest = async () => ({ messages: [{ role: "user", content: await f.build() }], manualRecallIds: [] });
        (processor as any).parseAndValidateResponse = () => ({ thoughts: {}, actions: [], request_heartbeat: false });
        const stimulus: any = { session: { platform: "test", selfId: "bot", channelId: "A", isDirect: false } };
        await expect((processor as any)[method]("turn", stimulus, () => {})).rejects.toThrow("upstream failed");
        expect(Array.isArray(await f.build())).toBe(true);
        fail = false;
        await (processor as any)[method]("turn", stimulus, () => {});
        expect(await f.build()).toBe("prompt");
    },
);
