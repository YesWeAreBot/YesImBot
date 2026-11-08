import { Bot, Context, MessageEncoder, Schema } from "koishi";
import { afterEach, expect, it, vi } from "vitest";

import { withReplyTurn } from "../src/agent/reply-turn";
import CoreUtilExtension from "../src/extension/builtin/core-util";
import { CoreUtilConfigSchema } from "../src/extension/builtin/core-util/config";
import { ToolService } from "../src/extension/service";
import { loggingStub } from "./helpers/yesimbot";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.useRealTimers();
});
function setup(overrides: Record<string, any> = {}, toolTimeouts: Record<string, number> = {}) {
    vi.useFakeTimers();
    const logger = { debug() {}, info() {}, warn() {}, error() {}, success() {} };
    const emitted: any[] = [];
    const model = {
        config: { timeoutPolicy: { totalTimeout: 120 }, retryPolicy: { maxRetries: 0 } },
        isVisionModel: () => true,
        chat: vi.fn<(...args: any[]) => Promise<any>>(async () => ({ text: "description" })),
    };
    const ctx: any = { filter: () => true, on() {}, logger: () => logger, emit: (...args: any[]) => emitted.push(args), bots: [] };
    const tools = new ToolService(ctx, { advanced: { timeout: 10000, maxRetry: 3, toolTimeouts } } as any, { logging: loggingStub(logger) } as any);
    ctx.yesimbot = {
        tool: tools,
        logging: loggingStub(logger),
        asset: {
            encode: async (text: string) => text,
            getInfo: async (id: string) => ({ id, mime: "image/png" }),
            read: async () => "data:image/jpeg;base64,AA==",
        },
        model: { getChatModel: () => model, useChatModel: () => model },
    };
    const config = CoreUtilConfigSchema({
        typing: { baseDelay: 0, minDelay: 0, maxDelay: 0 },
        vision: { model: { providerName: "provider", modelId: "vision" } },
        ...overrides,
    });
    const extension = new CoreUtilExtension(ctx, config);
    for (const definition of (extension as any).tools.values()) tools.registerTool(definition);
    const bot: any = {
        platform: "qq",
        selfId: "bot",
        user: { id: "bot" },
        sendMessage: vi.fn<(...args: any[]) => Promise<string[]>>(async () => ["id"]),
        session: (event: any) => ({ event, ...event }),
    };
    ctx.bots.push(bot);
    const session: any = { bot, platform: "qq", selfId: "bot", userId: "user", channelId: "group", event: { channel: { id: "group", type: 0 } } };
    cleanups.push(async () => tools.stop());
    return { tools, extension, model, bot, session, config, emitted, ctx };
}

it("lets a configured 120s vision request finish beyond the ordinary 10s budget", async () => {
    const f = setup();
    f.model.chat.mockImplementation(async () => new Promise((resolve) => setTimeout(() => resolve({ text: "visible after 110 seconds" }), 110000)));
    let settled = false;
    const invocation = f.tools.invoke("get_image_description", { image_id: "image", question: "what?" }, f.session).then((result) => {
        settled = true;
        return result;
    });
    await vi.advanceTimersByTimeAsync(10001);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100000);
    expect(await invocation).toMatchObject({ status: "success", result: "visible after 110 seconds" });
});

it("gives three paragraphs enough budget for the configured typing and paragraph delays", async () => {
    const f = setup({ typing: { baseDelay: 4000, minDelay: 4000, maxDelay: 4000 } });
    let sends = 0;
    f.bot.sendMessage.mockImplementation(async () => [`part-${++sends}`]);
    const invocation = f.tools.invoke("send_message", { message: "a<sep/>b<sep/>c" }, f.session);
    await vi.advanceTimersByTimeAsync(20000);
    expect(await invocation).toMatchObject({
        status: "success",
        metadata: { delivery: { sentMessages: 3, messageIds: ["part-1", "part-2", "part-3"], deliveryUnknown: false } },
    });
    expect(sends).toBe(3);
});

it("retains confirmed paragraphs when an explicit send deadline expires during a later typing delay", async () => {
    const f = setup({}, { send_message: 15 });
    const invocation = f.tools.invoke("send_message", { message: "first<sep/>second" }, f.session);
    await vi.advanceTimersByTimeAsync(16);
    expect(await invocation).toMatchObject({
        status: "error",
        error: { code: "TOOL.TIMEOUT", retryable: false },
        metadata: { delivery: { messageIds: ["id"], sentMessages: 1, totalMessages: 2, inFlight: false, deliveryUnknown: false } },
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.bot.sendMessage).toHaveBeenCalledTimes(1);
});

it("keeps an in-flight send with no returned ID unknown and never replays it", async () => {
    const f = setup({}, { send_message: 15 });
    let release!: (ids: string[]) => void;
    f.bot.sendMessage.mockImplementation(
        () =>
            new Promise((resolve) => {
                release = resolve;
            }),
    );
    const invocation = f.tools.invoke("send_message", { message: "first<sep/>second" }, f.session);
    await vi.advanceTimersByTimeAsync(16);
    expect(await invocation).toMatchObject({
        status: "error",
        metadata: { delivery: { messageIds: [], sentMessages: 0, inFlight: true, deliveryUnknown: true } },
    });
    release(["late-confirmation"]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.bot.sendMessage).toHaveBeenCalledTimes(1);
});

it("captures a real encoder's first confirmation when a later chunk is still pending at deadline", async () => {
    const f = setup({}, { send_message: 15 });
    const botContext = new Context();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
        release = resolve;
    });
    let visits = 0;
    class Encoder extends MessageEncoder {
        async visit() {
            visits++;
            this.results.push({ id: "encoder-confirmed", content: "first text" });
            await blocked;
        }
        async flush() {}
    }
    class Sender extends Bot {
        static MessageEncoder = Encoder;
    }
    const bot = new Sender(botContext, {} as any, "qq");
    bot.user = { id: "bot" };
    f.ctx.bots = [bot];
    const session = bot.session({ channel: { id: "group", type: 0 }, user: { id: "user" } });
    const invocation = f.tools.invoke("send_message", { message: "text and image<sep/>later paragraph" }, session);
    await vi.advanceTimersByTimeAsync(16);
    expect(await invocation).toMatchObject({
        status: "error",
        metadata: { delivery: { messageIds: ["encoder-confirmed"], sentMessages: 0, inFlight: true, deliveryUnknown: true } },
    });
    release();
    await vi.advanceTimersByTimeAsync(5000);
    expect(visits).toBe(1);
    await botContext.stop();
});

it("keeps ordinary tools bounded and honors an earlier upstream deadline", async () => {
    const f = setup();
    f.tools.registerTool({ name: "ordinary", description: "test", parameters: Schema.object({}), execute: async () => new Promise(() => {}) });
    const ordinary = f.tools.invoke("ordinary", {}, f.session);
    await vi.advanceTimersByTimeAsync(10001);
    expect(await ordinary).toMatchObject({ error: { code: "TOOL.TIMEOUT" }, metadata: { execution: { timeoutMs: 10000 } } });
    f.model.chat.mockImplementation(() => new Promise(() => {}));
    const vision = f.tools.invoke("get_image_description", { image_id: "image", question: "what?" }, f.session, { deadline: Date.now() + 40 });
    await vi.advanceTimersByTimeAsync(41);
    expect(await vision).toMatchObject({ error: { code: "TOOL.TIMEOUT" }, metadata: { execution: { timeoutMs: 40 } } });
});

it("still cancels a slow tool immediately with its parent turn", async () => {
    const f = setup();
    const controller = new AbortController();
    f.model.chat.mockImplementation(() => new Promise(() => {}));
    const invocation = withReplyTurn(
        () => true,
        () => f.tools.invoke("get_image_description", { image_id: "image", question: "what?" }, f.session),
        controller.signal,
    );
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await expect(invocation).rejects.toMatchObject({ name: "AbortError" });
});

it("defaults to direct vision, exposes configured auxiliary vision for text-only turns, and honors weak-vision opt-in", async () => {
    const f = setup();
    const names = (context?: any) => f.tools.getAvailableTools(f.session, context).map((tool) => tool.name);
    expect(names()).toContain("get_image_description");
    expect(names({ attachedImageIds: ["image"] })).not.toContain("get_image_description");
    expect((await f.tools.invoke("get_image_description", { image_id: "image", question: "what?" }, f.session, { attachedImageIds: ["image"] })).status).toBe(
        "error",
    );
    expect(f.model.chat).not.toHaveBeenCalled();
    f.config.vision.allowAuxiliary = true;
    expect(names({ attachedImageIds: ["image"] })).toContain("get_image_description");
    expect((await f.tools.invoke("get_image_description", { image_id: "image", question: "what?" }, f.session, { attachedImageIds: ["image"] })).status).toBe(
        "success",
    );
    f.config.vision.model = undefined as any;
    expect(names()).not.toContain("get_image_description");
});

it("rechecks auxiliary vision permission after reading pixels before foreground model dispatch", async () => {
    const f = setup();
    f.config.vision.allowAuxiliary = true;
    let release!: (value: string) => void;
    f.ctx.yesimbot.asset.read = vi.fn<() => Promise<string>>(
        () =>
            new Promise<string>((resolve) => {
                release = resolve;
            }),
    );
    const invocation = f.tools.invoke("get_image_description", { image_id: "image", question: "what?" }, f.session, { attachedImageIds: ["image"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.ctx.yesimbot.asset.read).toHaveBeenCalledTimes(1);
    f.config.vision.allowAuxiliary = false;
    release("data:image/jpeg;base64,AA==");
    expect(await invocation).toMatchObject({ status: "error" });
    expect(f.model.chat).not.toHaveBeenCalled();
});

it("keeps confirmed timeout receipts in the real heartbeat observation and counts a partial reply", async () => {
    const { HeartbeatProcessor } = await import("../src/agent/heartbeat-processor");
    const f = setup({}, { send_message: 15 });
    const observations: any[] = [];
    let modelCalls = 0;
    const processor = new HeartbeatProcessor(f.ctx, { heartbeat: 3, nativeToolCalling: true } as any, {
        model: {
            chat: async () => {
                modelCalls++;
                return { toolCalls: [{ toolName: "send_message", toolCallId: "send", args: JSON.stringify({ message: "first<sep/>second" }) }] };
            },
        } as any,
        prompt: {} as any,
        tool: f.tools,
        l1: {
            recordThought: async () => {},
            recordAction: async () => "action",
            recordObservation: async (...args: any[]) => observations.push(args[3]),
            recordHeartbeat: async () => {},
        } as any,
        contextBuilder: {} as any,
        logging: loggingStub(),
        world: {} as any,
    });
    (processor as any)._prepareLlmRequest = async () => ({ messages: [] });
    const invocation = processor.runCycle({ session: f.session } as any);
    await vi.advanceTimersByTimeAsync(16);
    expect(await invocation).toBe(true);
    expect(observations[0]).toMatchObject({
        status: "error",
        error: { code: "TOOL.TIMEOUT" },
        metadata: { delivery: { messageIds: ["id"], sentMessages: 1 } },
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(modelCalls).toBe(1);
    expect(f.bot.sendMessage).toHaveBeenCalledTimes(1);
});

it("does not automatically retry an explicitly retryable mutation", async () => {
    const f = setup();
    let attempts = 0;
    f.tools.registerTool({
        name: "mutation",
        description: "write",
        parameters: Schema.object({}),
        execute: async () => {
            attempts++;
            return { status: "error", error: { name: "RemoteWriteUncertain", message: "unknown", retryable: true } };
        },
    });
    expect(await f.tools.invoke("mutation", {}, f.session)).toMatchObject({ status: "error", error: { retryable: false } });
    expect(attempts).toBe(1);
});

it("never starts a mutation after its caller's absolute deadline has already expired", async () => {
    const f = setup();
    const result = await f.tools.invoke("send_message", { message: "too late" }, f.session, { deadline: Date.now() });
    expect(result).toMatchObject({ error: { code: "TOOL.TIMEOUT" }, metadata: { execution: { externalWorkMayContinue: false } } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.bot.sendMessage).not.toHaveBeenCalled();
});

for (const nativeToolCalling of [false, true]) {
    it(`keeps actual image tracking while filtering auxiliary tools from final ${nativeToolCalling ? "native and fallback" : "JSON"} requests`, async () => {
        const { PromptContextBuilder } = await import("../src/agent/context-builder");
        const { HeartbeatProcessor } = await import("../src/agent/heartbeat-processor");
        const { PromptService } = await import("../src/prompt/service");
        const { h } = await import("koishi");
        const f = setup();
        const config: any = {
            enableVision: true,
            maxImagesInContext: 1,
            imageLifecycleCount: 1,
            allowedImageTypes: ["image/png"],
            detail: "low",
            multiModalSystemTemplate: "Inspect the pixels directly.",
            nativeToolCalling,
            contextInputBudgetTokens: 6000,
        };
        const photo = {
            type: "message",
            id: "photo",
            sender: { id: "user" },
            timestamp: new Date(),
            content: '<img id="image"/> What is this?',
            elements: h.parse('<img id="image"/> What is this?'),
            is_new: true,
        };
        const world: any = {
            isChannelAllowed: () => true,
            getConversationState: async () => ({ unknown: true }),
            buildWorldState: async () => ({
                channel: { platform: "qq", id: "group", type: "guild" },
                self: { id: "bot" },
                l1_working_memory: { processed_events: [], new_events: [photo] },
            }),
        };
        const builder = new PromptContextBuilder(f.ctx, config, {
            model: { hasVisionCapability: () => true } as any,
            tool: f.tools,
            world,
            asset: f.ctx.yesimbot.asset,
            logging: loggingStub(),
            memory: { getMemoryBlocksForRendering: () => [] } as any,
        });
        let originalContent: unknown;
        const buildMultimodal = builder.buildMultimodalUserMessage.bind(builder);
        builder.buildMultimodalUserMessage = async (...args) => {
            const content = await buildMultimodal(...args);
            originalContent = content;
            return content;
        };
        const prompt = new PromptService(f.ctx, {} as any, loggingStub());
        prompt.registerTemplate("agent.system", "Available tools: {{#TOOL_DEFINITION}}{{name}} {{/TOOL_DEFINITION}}");
        prompt.registerTemplate("agent.user", "What is in the attached picture?");
        const modelRequests: any[] = [];
        config.heartbeat = 1;
        config.nativeToolCorrectionRetries = 0;
        const mainModel = {
            chat: async (options: any) => {
                modelRequests.push(options);
                return nativeToolCalling
                    ? {
                          toolCalls: [
                              {
                                  toolName: "get_image_description",
                                  toolCallId: "same-image",
                                  args: JSON.stringify({ image_id: "image", question: "describe again" }),
                              },
                          ],
                      }
                    : {
                          text: JSON.stringify({
                              thoughts: {},
                              actions: [{ function: "get_image_description", params: { image_id: "image", question: "describe again" } }],
                              request_heartbeat: false,
                          }),
                      };
            },
        };
        const processor = new HeartbeatProcessor(f.ctx, config, {
            model: mainModel as any,
            tool: f.tools,
            world,
            contextBuilder: builder,
            l1: { recordThought: async () => {}, recordAction: async () => "action", recordObservation: async () => {} } as any,
            prompt,
            logging: loggingStub(),
        });
        const request = await (processor as any)._prepareLlmRequest({ type: "user_message", session: f.session, payload: { messageIds: ["photo"] } });
        expect(request.messages[1].content).toBe(originalContent);
        expect(builder.getAttachedImageIds(request.messages)).toEqual(["image"]);
        expect(request.messages[0].content).not.toContain("get_image_description");
        expect(request.messages[0].content).toContain("send_message");
        const fallback = request.fallbackMessages ?? request.messages;
        expect(fallback[0].content).not.toContain("get_image_description");
        expect(builder.getAttachedImageIds(fallback)).toEqual(["image"]);
        const context = { attachedImageIds: builder.getAttachedImageIds(request.messages) };
        expect(f.tools.getAvailableTools(f.session, context).map((tool) => tool.name)).not.toContain("get_image_description");
        const denied = await f.tools.invoke("get_image_description", { image_id: "image", question: "describe again" }, f.session, context);
        expect(denied).toMatchObject({ status: "error", error: { name: "ToolUnavailableError" } });
        expect(denied.error?.message).toContain("图片已随本轮主请求提供");
        expect(f.model.chat).not.toHaveBeenCalled();
        builder.commitMultimodalUsage(request.messages);
        expect([...(builder as any).imageLifecycleTracker.values()]).toContain(1);
        expect(builder.getAttachedImageIds(request.messages)).toEqual(["image"]);
        expect(await processor.runCycle({ type: "user_message", session: f.session, payload: { messageIds: ["photo"] } } as any)).toBe(false);
        expect(modelRequests).toHaveLength(1);
        const offered = modelRequests[0].tools?.map((tool: any) => tool.function.name) ?? modelRequests[0].messages[0].content;
        expect(offered).not.toContain("get_image_description");
        expect(f.model.chat).not.toHaveBeenCalled();
    });
}

for (const mode of ["search", "static", "dynamic"] as const) {
    it(`lets the real builtin ${mode} web operation use its HTTP/browser budget beyond 10 seconds`, async () => {
        const { default: SearchExtension } = await import("../src/extension/builtin/search");
        const f = setup();
        Object.assign(f.ctx.logger, f.ctx.logger());
        f.ctx.http = {
            get: async () =>
                new Promise((resolve) =>
                    setTimeout(
                        () =>
                            resolve(
                                mode === "search" ? { results: [{ title: "Result", url: "https://example.test/", content: "Body" }] } : "<html>Body</html>",
                            ),
                        12000,
                    ),
                ),
        };
        f.ctx.puppeteer = {
            page: async () => ({
                setUserAgent: async () => {},
                setViewport: async () => {},
                setDefaultNavigationTimeout: async () => {},
                goto: async () => new Promise((resolve) => setTimeout(() => resolve({ ok: () => true }), 25000)),
                setContent: async () => new Promise((resolve) => setTimeout(resolve, 25000)),
                evaluate: async () => ({ title: "Page", content: "<p>Body</p>", textContent: "Body", links: [] }),
                close: async () => {},
            }),
        };
        f.session.app = f.ctx;
        const extension = new SearchExtension(f.ctx, SearchExtension.Config({ httpTimeout: 15000, puppeteerTimeout: 30000, puppeteerWaitTime: 2000 }));
        for (const definition of (extension as any).tools.values()) f.tools.registerTool(definition);
        const toolName = mode === "search" ? "web_search" : "fetch_webpage";
        const params = mode === "search" ? { query: "term" } : { url: "https://example.test/", use_dynamic: mode === "dynamic" };
        let finished = false;
        const invocation = f.tools.invoke(toolName, params, f.session).then((result) => {
            finished = true;
            return result;
        });
        await vi.advanceTimersByTimeAsync(10001);
        expect(finished).toBe(false);
        await vi.advanceTimersByTimeAsync(30000);
        expect(await invocation).toMatchObject({ status: "success" });
    });
}
