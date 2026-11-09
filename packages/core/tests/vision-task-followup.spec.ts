import { readFileSync } from "node:fs";

import { h } from "koishi";
import { expect, it, vi } from "vitest";

import { PromptContextBuilder } from "../src/agent/context-builder";
import { HeartbeatProcessor } from "../src/agent/heartbeat-processor";
import { ChatModelSwitcher } from "../src/model/service";
import { PromptService } from "../src/prompt/service";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

const resource = (name: string) => readFileSync(new URL(`../resources/${name}`, import.meta.url), "utf8");
function fixture() {
    const diagnostics: string[] = [];
    const logger: any = { extend: () => logger, debug: (text: string) => diagnostics.push(text), info() {}, warn() {}, error() {}, success() {} };
    const logging = loggingStub(logger);
    const config: any = {
        enableVision: true,
        allowedImageTypes: ["image/png"],
        maxImagesInContext: 1,
        imageLifecycleCount: 1,
        detail: "low",
        multiModalSystemTemplate: "Images are provided as pixels.",
        heartbeat: 6,
        contextInputBudgetTokens: 6000,
        userTemplate: resource("prompts/user_base.txt"),
    };
    const session: any = { platform: "mock", channelId: "room", userId: "alice", selfId: "bot", isDirect: false, bot: {} };
    const photo: any = {
        type: "message",
        id: "photo",
        channelType: "guild",
        sender: { id: "alice", name: "Alice" },
        timestamp: new Date(),
        content: '<img id="pixels"/> ORIGINAL_IMAGE_QUESTION',
        elements: h.parse('<img id="pixels"/> ORIGINAL_IMAGE_QUESTION'),
        is_message: true,
        is_new: true,
    };
    const records = new Map<string, any>([[photo.id, photo]]);
    let visible: any[] = [photo],
        generation = 0,
        lookups = 0;
    const world: any = {
        isChannelAllowed: () => true,
        l2_manager: { getHistoryGeneration: () => generation, watchHistory: () => () => {} },
        buildWorldState: async (current: any) => ({
            channel: { platform: "mock", type: "guild", id: current.channelId },
            self: { id: "bot" },
            l1_working_memory: { processed_events: visible.filter((item) => !item.is_new), new_events: visible.filter((item) => item.is_new) },
        }),
        getConversationState: async () => ({ unknown: true }),
        readMessageWindow: vi.fn<(_session: any, options: any) => Promise<any>>(async (_session: any, options: any) => ({
            anchor: { ...records.get(options.messageId), platform: "mock", channelId: "room" },
            quotes: [],
        })),
    };
    const ctx: any = stubCtx({}, { filter: () => true });
    const wires: Array<{ model: string; messages: any[] }> = [];
    const models: any[] = [false, true].map((vision) => ({
        id: vision ? "visual" : "text",
        config: { abilities: [], retryPolicy: { maxRetries: 0 }, timeoutPolicy: { totalTimeout: 3 } },
        isVisionModel: () => vision,
        chat: async (request: any) => {
            wires.push({ model: vision ? "visual" : "text", messages: request.messages });
            const lookup = lookups-- > 0;
            return {
                text: JSON.stringify({ thoughts: {}, actions: lookup ? [{ function: "lookup", params: {} }] : [], request_heartbeat: lookup }),
                finishReason: "stop",
                usage: { prompt_tokens: 1, completion_tokens: 1 },
            };
        },
    }));
    const model = new ChatModelSwitcher(
        ctx,
        { name: "mixed", models: models.map((item) => ({ providerName: "test", modelId: item.id })) },
        (_provider, id) => models.find((item) => item.id === id),
        logging,
    );
    const tool: any = { getToolSchemas: () => [], invoke: async () => ({ status: "success", result: "lookup completed" }) };
    const asset: any = {
        getInfo: vi.fn<(id: string) => Promise<any>>(async (id: string) => ({ id, mime: "image/png" })),
        read: vi.fn<() => Promise<string>>(async () => "data:image/png;base64,cGl4ZWxz"),
    };
    const builder = new PromptContextBuilder(ctx, config, { logging, model, world, tool, asset, memory: { getMemoryBlocksForRendering: () => [] } as any });
    const prompt = new PromptService(ctx, {} as any, logging);
    prompt.registerTemplate("agent.system", "Follow the current question.");
    prompt.registerTemplate("agent.user", config.userTemplate);
    for (const name of ["world_state", "l1_history_item"]) prompt.registerTemplate(`agent.partial.${name}`, resource(`templates/${name}.mustache`));
    const l1: any = {
        recordThought: async () => {},
        recordAction: async () => "action",
        recordObservation: async (_id: string, _platform: string, _channel: string, observation: any) => {
            visible.push({ type: "agent_observation", timestamp: new Date(), is_agent_observation: true, is_new: true, ...observation });
        },
        recordHeartbeat: async () => {},
    };
    const processor = new HeartbeatProcessor(ctx, config, { model, world, tool, logging, prompt, l1, contextBuilder: builder });
    const stimulus = (id: string): any => ({ type: "user_message", session: { ...session, messageId: id }, payload: { messageIds: [id] } });
    const followUp = (id: string, keepPhoto = false, userId = "alice") => {
        const message: any = {
            ...photo,
            id,
            sender: { id: userId, name: userId },
            timestamp: new Date(),
            content: "那图右边的小字是什么？",
            elements: h.parse("那图右边的小字是什么？"),
        };
        records.set(id, message);
        visible = keepPhoto ? [{ ...photo, is_new: false }, message] : [message];
        return { ...stimulus(id), session: { ...session, userId, messageId: id } };
    };
    return {
        config,
        model,
        session,
        photo,
        records,
        world,
        asset,
        builder,
        processor,
        wires,
        diagnostics,
        stimulus,
        followUp,
        setLookups: (count: number) => (lookups = count),
        setVisible: (messages: any[]) => (visible = messages),
        clear: () => generation++,
    };
}
const images = (messages: any[]) =>
    messages.flatMap((message) => (Array.isArray(message.content) ? message.content.filter((part: any) => part.type === "image_url") : []));

it.each([1, 2])(
    "keeps pixels in the final visual-model request across an unquoted follow-up and several tool heartbeats with lifecycle=%s",
    async (lifecycle) => {
        const f = fixture();
        f.config.imageLifecycleCount = lifecycle;
        await f.processor.runCycle(f.stimulus("photo"));
        f.setLookups(3);
        await f.processor.runCycle(f.followUp("follow-up"));
        expect(f.wires).toHaveLength(5);
        for (const request of f.wires) {
            expect(request.model).toBe("visual");
            expect(images(request.messages)).toHaveLength(1);
            expect(images(request.messages)[0].image_url.url).toBe("data:image/png;base64,cGl4ZWxz");
        }
        expect(f.world.readMessageWindow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ messageId: "photo" }));
    },
);

it.each([1, 2])("counts a user task once instead of consuming the image lifetime on each internal heartbeat with lifecycle=%s", async (lifecycle) => {
    const f = fixture();
    f.config.imageLifecycleCount = lifecycle;
    f.setLookups(4);
    await f.processor.runCycle(f.stimulus("photo"));
    expect(f.wires).toHaveLength(5);
    expect(f.wires.every((request) => request.model === "visual" && images(request.messages).length === 1)).toBe(true);
    expect([...(f.builder as any).imageLifecycleTracker.values()]).toEqual([1]);
});

it("does not recover a cleared or another user's previously seen image", async () => {
    const f = fixture();
    await f.processor.runCycle(f.stimulus("photo"));
    await f.processor.runCycle(f.followUp("other-user", false, "bob"));
    expect(images(f.wires.at(-1)!.messages)).toHaveLength(0);
    f.clear();
    await f.processor.runCycle(f.followUp("after-clear"));
    expect(images(f.wires.at(-1)!.messages)).toHaveLength(0);
});

it("expires unquoted recent-image protection after the configured user-message window", async () => {
    const f = fixture();
    f.config.imageFollowUpMaxTurns = 1;
    await f.processor.runCycle(f.stimulus("photo"));
    await f.processor.runCycle(f.followUp("first-follow-up", true));
    expect(images(f.wires.at(-1)!.messages)).toHaveLength(1);
    await f.processor.runCycle(f.followUp("second-follow-up", true));
    expect(images(f.wires.at(-1)!.messages)).toHaveLength(0);
});

it("isolates recent source recovery by canonical conversation", async () => {
    const f = fixture();
    await f.processor.runCycle(f.stimulus("photo"));
    const other = f.followUp("other-room");
    other.session.channelId = "other-room";
    await f.processor.runCycle(other);
    expect(images(f.wires.at(-1)!.messages)).toHaveLength(0);
    expect(f.world.readMessageWindow).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ messageId: "photo" }));
});

it("expires an unquoted image after the configured time window", async () => {
    const f = fixture();
    await f.processor.runCycle(f.stimulus("photo"));
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 601000);
    try {
        await f.processor.runCycle(f.followUp("expired", true));
        expect(images(f.wires.at(-1)!.messages)).toHaveLength(0);
        expect(f.diagnostics.some((line) => line.includes("recent_image_window_expired"))).toBe(true);
    } finally {
        clock.mockRestore();
    }
});

it("recognizes only builder-created image parts as attached pixels, including after success", async () => {
    const f = fixture();
    const prepared = await (f.processor as any)._prepareLlmRequest(f.stimulus("photo"));
    f.builder.commitMultimodalUsage(prepared.messages);
    expect(f.builder.getAttachedImageIds(prepared.messages)).toEqual(["pixels"]);
    expect(f.builder.getAttachedImageIds([{ content: [{ type: "text", text: "The following is an image with ID #pixels:" }] }])).toEqual([]);
    expect(f.builder.getAttachedImageIds(structuredClone(prepared.messages))).toEqual(["pixels"]);
    expect(f.builder.getAttachedImageIds([{ content: [{ type: "image_url", image_url: { url: "data:image/png;base64,dW5rbm93bg==" } }] }])).toEqual([]);
});

it.each(["disabled", "text-only", "count-limit", "unsupported-type", "missing-asset", "invalid-pixels"])(
    "diagnoses %s without exposing pixels, source text, or URLs",
    async (reason) => {
        const f = fixture();
        if (reason === "disabled") f.config.enableVision = false;
        if (reason === "text-only") vi.spyOn(f.model, "hasVisionCapability").mockReturnValue(false);
        if (reason === "count-limit") f.config.maxImagesInContext = 0;
        if (reason === "unsupported-type") f.asset.getInfo.mockResolvedValue({ id: "pixels", mime: "image/gif" });
        if (reason === "missing-asset") f.asset.getInfo.mockResolvedValue(undefined);
        if (reason === "invalid-pixels") f.asset.read.mockResolvedValue("a text description, not image pixels");
        await f.processor.runCycle(f.stimulus("photo"));
        expect(images(f.wires[0].messages)).toHaveLength(0);
        const log = f.diagnostics.filter((line) => line.startsWith("图片上下文 |"));
        const markers: Record<string, string> = {
            disabled: "vision_disabled",
            "text-only": "no_vision_model",
            "count-limit": '"count_limit":1',
            "unsupported-type": '"unsupported_mime":1',
            "missing-asset": '"missing_asset":1',
            "invalid-pixels": '"invalid_image_data":1',
        };
        expect(log.join(" ")).toContain(markers[reason]);
        expect(log.join(" ")).not.toMatch(/data:image|ORIGINAL_IMAGE_QUESTION|cGl4ZWxz|a text description/);
    },
);

it("keeps usage accounting when tool-schema rendering clones the content array and text parts", async () => {
    const f = fixture();
    f.config.imageLifecycleCount = 2;
    const prepared = await (f.processor as any)._prepareLlmRequest(f.stimulus("photo"));
    prepared.messages[1].content = prepared.messages[1].content.map((part: any) => (part.type === "text" ? { ...part, text: part.text + " updated" } : part));
    expect(f.builder.getAttachedImageIds(prepared.messages)).toEqual(["pixels"]);
    f.builder.commitMultimodalUsage(prepared.messages);
    expect([...(f.builder as any).imageLifecycleTracker.values()]).toEqual([1]);
});

it.each(["asset_metadata_failed", "asset_read_failed"])("diagnoses %s without logging storage error contents", async (reason) => {
    const f = fixture();
    if (reason === "asset_metadata_failed") f.asset.getInfo.mockRejectedValue(new Error("SECRET_IMAGE_URL"));
    else f.asset.read.mockRejectedValue(new Error("SECRET_IMAGE_URL"));
    const building = (f.processor as any)._prepareLlmRequest(f.stimulus("photo"));
    await expect(building).rejects.toThrow("SECRET_IMAGE_URL");
    const diagnostics = f.diagnostics.filter((line) => line.startsWith("图片上下文 |"));
    expect(diagnostics.join(" ")).toContain(reason);
    expect(diagnostics.join(" ")).not.toContain("SECRET_IMAGE_URL");
});

it("counts same-user messages that did not wake the agent toward the follow-up limit", async () => {
    const f = fixture();
    f.config.imageFollowUpMaxTurns = 1;
    await f.processor.runCycle(f.stimulus("photo"));
    const follow = f.followUp("waking-follow-up", true);
    f.setVisible([
        { ...f.photo, is_new: false },
        { ...f.records.get("waking-follow-up"), id: "silent-follow-up", is_new: false },
        f.records.get("waking-follow-up"),
    ]);
    await f.processor.runCycle(follow);
    expect(images(f.wires.at(-1)!.messages)).toHaveLength(0);
    expect(f.diagnostics.some((line) => line.includes('"follow_up_count":2'))).toBe(true);
});

it("recovers the latest same-user image skipped while busy even after it leaves L1", async () => {
    const f = fixture();
    f.photo.timestamp = new Date(Date.now() - 1000);
    await f.processor.runCycle(f.stimulus("photo"));
    const newer = {
        ...f.photo,
        id: "skipped-photo",
        timestamp: new Date(Date.now()),
        content: '<img id="new-pixels"/>',
        elements: h.parse('<img id="new-pixels"/>'),
    };
    f.records.set(newer.id, newer);
    const follow = f.followUp("after-skipped-photo");
    f.world.readMessageWindow.mockImplementation(async (_session: any, options: any) => ({
        anchor: { ...f.records.get(options.messageId), platform: "mock", channelId: "room" },
        quotes: [],
        records: options.before ? [newer, f.records.get("after-skipped-photo")].map((record) => ({ ...record, platform: "mock", channelId: "room" })) : [],
    }));
    await f.processor.runCycle(follow);
    expect(f.builder.getAttachedImageIds(f.wires.at(-1)!.messages)).toEqual(["new-pixels"]);
});

it("rejects discovery results when history is cleared while the bounded window is being read", async () => {
    const f = fixture();
    await f.processor.runCycle(f.stimulus("photo"));
    const follow = f.followUp("after-clear-during-discovery");
    let release!: (page: any) => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => (started = resolve));
    f.world.readMessageWindow.mockImplementationOnce(async () => {
        started();
        return await new Promise((resolve) => (release = resolve));
    });
    const building = f.builder.build(follow);
    await reading;
    f.clear();
    release({ anchor: f.records.get("after-clear-during-discovery"), records: [{ ...f.photo, platform: "mock", channelId: "room" }], quotes: [] });
    await expect(building).rejects.toThrow("历史已清除");
    expect(f.asset.read).toHaveBeenCalledTimes(1);
    await f.processor.runCycle(f.followUp("new-epoch-follow-up"));
    expect(images(f.wires.at(-1)!.messages)).toHaveLength(0);
});
