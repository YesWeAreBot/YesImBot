import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Bot, Context } from "koishi";
import { expect, it, vi } from "vitest";

import { ChatModel } from "../src/model/chat-model";
import { ModelAbility } from "../src/model/config";
import { EvaluationModel } from "../src/model/evaluation-model";
import { anthropicRequest } from "../src/model/native/anthropic";
import { ModelService } from "../src/model/service";
import { getUsageLedger } from "../src/model/usage";
import { EventListenerManager } from "../src/world/event-listener";
import { loggingStub, stubCtx } from "./helpers/yesimbot";
const frame = (delta: any, finish_reason: any = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const tool = { type: "function", function: { name: "lookup", parameters: { type: "object" } }, execute: vi.fn<() => object>(() => ({})) };
for (const stream of [false, true])
    for (const kind of ["invalid-json", "unknown-tool"])
        it(`returns raw ${kind} for framework correction (${stream})`, async () => {
            const call = {
                index: 0,
                id: "call",
                type: "function",
                function: { name: kind === "unknown-tool" ? "unknown" : "lookup", arguments: kind === "invalid-json" ? "{invalid" : "{}" },
            };
            const model = new ChatModel(
                stubCtx(),
                () => ({ model: "m", baseURL: "https://test.invalid/v1/", apiKey: "test" }),
                { modelId: "m", abilities: [ModelAbility.Chat], parameters: { stream } },
                async () =>
                    new Response(
                        stream
                            ? frame({ tool_calls: [call] }) + frame({}, "tool_calls") + "data: [DONE]\n\n"
                            : JSON.stringify({ choices: [{ message: { role: "assistant", content: "", tool_calls: [call] }, finish_reason: "tool_calls" }] }),
                        { headers: { "content-type": stream ? "text/event-stream" : "application/json" } },
                    ),
                loggingStub(),
            );
            const result = await model.chat({ messages: [], tools: [tool], singleStep: true, maxSteps: 1 });
            expect(result.toolCalls?.[0]).toMatchObject({ toolName: call.function.name, args: call.function.arguments });
            expect(tool.execute).not.toHaveBeenCalled();
        });
it("sends reasoning on the actual next SDK HTTP request", async () => {
    const sent: any[] = [];
    const model = new ChatModel(
        stubCtx(),
        () => ({ model: "m", baseURL: "https://test.invalid/v1/", apiKey: "test" }),
        { modelId: "m", abilities: [ModelAbility.Chat], parameters: { stream: true } },
        async (_u, init) => {
            sent.push(JSON.parse(String(init?.body)));
            return new Response(
                sent.length === 1
                    ? frame({ reasoning_content: "private reasoning" }) +
                          frame({ tool_calls: [{ index: 0, id: "call", type: "function", function: { name: "lookup", arguments: "{}" } }] }) +
                          frame({}, "tool_calls") +
                          "data: [DONE]\n\n"
                    : frame({ content: "done" }) + frame({}, "stop") + "data: [DONE]\n\n",
                { headers: { "content-type": "text/event-stream" } },
            );
        },
        loggingStub(),
    );
    await model.chat({ messages: [], tools: [tool], maxSteps: 2 });
    expect(sent[1].messages.find((m: any) => m.role === "assistant").reasoning_content).toBe("private reasoning");
});
it("finalizes failed evaluation HTTP responses without keeping a pending body", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "yib-eval-audit-"));
    const ctx: any = stubCtx();
    ctx.baseDir = dir;
    ctx.scope = { key: "audit" };
    const owner = { context: ctx };
    try {
        const model = new EvaluationModel(
            ctx,
            () => ({ model: "m", baseURL: "https://test.invalid/v1/", apiKey: "x" }),
            { modelId: "m", abilities: [ModelAbility.Evaluation] },
            async () => new Response("error", { status: 500 }),
            loggingStub(),
            owner,
        );
        await expect(model.evaluate({}, { a: { type: "noul" } })).rejects.toThrow(Error);
        const ledger = getUsageLedger(ctx, owner);
        await new Promise((r) => setTimeout(r, 50));
        expect((await ledger.snapshot()).records).toMatchObject([{ status: "http-500", count: 1 }]);
        await ledger.close();
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
it("uses auto tools with manual Anthropic thinking", () => {
    expect(
        anthropicRequest({ model: "claude", messages: [], thinking: { type: "enabled", budget_tokens: 1024 }, tool_choice: "required", tools: [tool] })
            .tool_choice,
    ).toEqual({ type: "auto" });
});

it("filters after-send before observing or transforming a message for another instance", async () => {
    const ctx = new Context();
    const bot = Object.create(Bot.prototype);
    Object.assign(bot, { ctx, platform: "test", user: { id: "bot", name: "Bot" } });
    const services = ["a", "b"].map((channel) => {
        const service = { observeChannel: vi.fn<() => void>(), recordMessage: vi.fn<() => void>(), isChannelAllowed: () => true };
        const asset = { transform: vi.fn<(text: string) => Promise<string>>(async (text) => text) };
        const manager = new EventListenerManager(
            ctx.intersect((session) => session.channelId === channel),
            service as any,
            {} as any,
            loggingStub(),
            asset as any,
        );
        manager.start();
        return { service, asset, manager };
    });
    try {
        const session = bot.session({ type: "send", channel: { id: "a", type: 0 }, message: { id: "sent", content: "hello" } });
        session.content = "hello";
        await ctx.parallel("after-send", session);
        expect(services[0].service.recordMessage).toHaveBeenCalledOnce();
        expect(services[1].service.observeChannel).not.toHaveBeenCalled();
        expect(services[1].asset.transform).not.toHaveBeenCalled();
        expect(services[1].service.recordMessage).not.toHaveBeenCalled();
    } finally {
        services.forEach(({ manager }) => manager.stop());
        await ctx.stop();
    }
});

it("applies configured deadline to a fixed chat model while retaining its capability API", async () => {
    const logger: any = { extend: () => logger, debug() {}, info() {}, warn() {}, error() {}, success() {} };
    const ctx = stubCtx({ logging: { getLogger: () => logger } });
    let signal: AbortSignal | undefined;
    const model = new ChatModel(
        ctx,
        () => ({ model: "m", baseURL: "https://test.invalid/v1/" }),
        {
            modelId: "m",
            abilities: [ModelAbility.Chat],
            parameters: { stream: false },
            timeoutPolicy: { totalTimeout: 0.01 },
            retryPolicy: { maxRetries: 0 },
        },
        async (_url, init) => {
            signal = init?.signal as AbortSignal;
            return new Promise((_resolve, reject) => {
                if (signal!.aborted) reject(signal!.reason);
                else signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
            });
        },
        loggingStub(logger),
    );
    const service: any = Object.create(ModelService.prototype);
    Object.assign(service, { ctx, logging: loggingStub(logger), getChatModel: () => model });
    const selected = service.useChatModel("p", "m");
    expect(selected.config).toBe(model.config);
    expect(selected.isVisionModel()).toBe(false);
    await expect(selected.chat({ messages: [] })).rejects.toThrow(Error);
    expect(signal?.aborted).toBe(true);
});
for (const selected of ["required", { type: "function", function: { name: "lookup" } }])
    it("downgrades forced Anthropic tools when manual thinking is enabled", () => {
        expect(
            anthropicRequest({ model: "claude", messages: [], thinking: { type: "enabled", budget_tokens: 1024 }, tool_choice: selected, tools: [tool] })
                .tool_choice,
        ).toEqual({ type: "auto" });
    });
