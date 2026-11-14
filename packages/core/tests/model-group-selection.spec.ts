import type { GenerateTextResult } from "@xsai/generate-text";
import { afterEach, expect, it, vi } from "vitest";

import type { Config } from "../src/config";
import { BaseModel } from "../src/model/base-model";
import type { ChatRequestOptions, IChatModel } from "../src/model/chat-model";
import { ContentFailureAction, ModelAbility, ModelSwitchingStrategy, TaskType, type ModelConfig } from "../src/model/config";
import { ChatModelSwitcher, ModelService } from "../src/model/service";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

const logger = { extend: () => logger, debug() {}, info() {}, success() {}, warn() {}, error() {} };
const logging = loggingStub(logger);
const ctx = stubCtx({}, { scope: { update() {} }, schema: { set() {} }, notifier: { create() {} } });
const input = (): ChatRequestOptions => ({ messages: [{ role: "user", content: "hello" }] });
const imageInput = (): ChatRequestOptions => ({
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,dGVzdA==" } }] }],
});
const response = (text: string): GenerateTextResult => ({
    text,
    finishReason: "stop",
    messages: [{ role: "assistant", content: text }],
    steps: [],
    toolCalls: [],
    toolResults: [],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

// Only the external model operation is simulated; real switchers handle selection, retries and breakers.
class ExternalModel extends BaseModel implements IChatModel {
    constructor(
        id: string,
        private readonly attempts: string[],
        private readonly reply: () => Promise<GenerateTextResult> = async () => response(id),
        config: Partial<ModelConfig> = {},
    ) {
        super(
            ctx,
            {
                modelId: id,
                abilities: [ModelAbility.Chat],
                timeoutPolicy: { totalTimeout: 5 },
                retryPolicy: { maxRetries: 0, onContentFailure: ContentFailureAction.FailoverToNext },
                ...config,
            },
            "test",
            logging,
        );
    }

    isVisionModel() {
        return this.config.abilities.includes(ModelAbility.Vision);
    }

    async chat(options: ChatRequestOptions) {
        this.attempts.push(this.id);
        options.onStreamStart?.();
        return this.reply();
    }
}

function group(models: ExternalModel[], strategy?: ModelSwitchingStrategy) {
    const config = { name: "selection", models: models.map((model) => ({ providerName: "test", modelId: model.id })), strategy };
    return new ChatModelSwitcher(ctx, config, (_provider, id) => models.find((model) => model.id === id) ?? null, logging);
}

const descriptor = (modelId: string) => ({ providerName: "test", modelId });

function service() {
    const config = {
        providers: [
            {
                name: "test",
                type: "OpenAI",
                apiKey: "test",
                models: ["alias", "literal"].map((modelId) => ({ modelId, abilities: [ModelAbility.Chat, ModelAbility.Embedding] })),
            },
        ],
        modelGroups: [
            { name: "selected", models: [descriptor("alias")], strategy: ModelSwitchingStrategy.Failover },
            ...["specialty", "constructor", TaskType.Chat, TaskType.Embedding].map((name) => ({
                name,
                models: [descriptor("literal")],
                strategy: ModelSwitchingStrategy.Failover,
            })),
        ],
        task: { chat: "selected", embed: "selected" },
    } as Config;
    return new ModelService(ctx, config, logging);
}

afterEach(() => vi.restoreAllMocks());

it.each(["specialty", "constructor"])("resolves configured literal group %s for chat and embedding callers", (name) => {
    const model = service();
    expect(
        model
            .useChatGroup(name)
            ?.getModels()
            .map((item) => item.id),
    ).toEqual(["literal"]);
    expect(
        model
            .useEmbeddingGroup(name)
            ?.getModels()
            .map((item) => item.id),
    ).toEqual(["literal"]);
    expect(model.useChatGroup("missing")).toBeUndefined();
    expect(model.useEmbeddingGroup("missing")).toBeUndefined();
});

it("keeps task aliases ahead of literal groups with the same name", () => {
    const model = service();
    expect(
        model
            .useChatGroup(TaskType.Chat)
            ?.getModels()
            .map((item) => item.id),
    ).toEqual(["alias"]);
    expect(
        model
            .useEmbeddingGroup(TaskType.Embedding)
            ?.getModels()
            .map((item) => item.id),
    ).toEqual(["alias"]);
});

it.each([undefined, ModelSwitchingStrategy.Failover])("preserves first-model selection for strategy %s", async (strategy) => {
    const attempts: string[] = [];
    const switcher = group([new ExternalModel("a", attempts), new ExternalModel("b", attempts)], strategy);
    for (let i = 0; i < 3; i++) expect((await switcher.chat(input())).text).toBe("a");
    expect(attempts).toEqual(["a", "a", "a"]);
});

it("rotates first attempts across consecutive round-robin requests", async () => {
    const attempts: string[] = [];
    const switcher = group(
        ["a", "b", "c"].map((id) => new ExternalModel(id, attempts)),
        ModelSwitchingStrategy.RoundRobin,
    );
    const replies: string[] = [];
    for (let i = 0; i < 4; i++) replies.push((await switcher.chat(input())).text);
    expect(replies).toEqual(["a", "b", "c", "a"]);
    expect(attempts).toEqual(replies);
});

it("advances across repeated descriptors instead of getting stuck on the same model", async () => {
    const attempts: string[] = [];
    const repeated = new ExternalModel("a", attempts);
    const switcher = group([repeated, repeated, new ExternalModel("b", attempts)], ModelSwitchingStrategy.RoundRobin);
    const replies: string[] = [];
    for (let i = 0; i < 6; i++) replies.push((await switcher.chat(input())).text);
    expect(replies).toEqual(["a", "a", "b", "a", "a", "b"]);
});

it("keeps image and text rotation independent after vision filtering", async () => {
    const attempts: string[] = [];
    const switcher = group(
        [
            new ExternalModel("text", attempts),
            ...["vision-a", "vision-b"].map((id) => new ExternalModel(id, attempts, undefined, { abilities: [ModelAbility.Chat, ModelAbility.Vision] })),
        ],
        ModelSwitchingStrategy.RoundRobin,
    );
    const replies: string[] = [];
    for (const request of [input(), imageInput(), input(), imageInput(), imageInput(), input()]) {
        replies.push((await switcher.chat(request)).text);
    }
    expect(replies).toEqual(["text", "vision-a", "vision-a", "vision-b", "vision-a", "vision-b"]);
});

it("retains same-model retries and failover within each rotated request", async () => {
    const attempts: string[] = [];
    let calls = 0;
    const primary = new ExternalModel(
        "a",
        attempts,
        async () => {
            if (++calls === 1) throw new Error("temporary failure");
            return response("a");
        },
        { retryPolicy: { maxRetries: 1, onContentFailure: ContentFailureAction.FailoverToNext } },
    );
    const failing = new ExternalModel("b", attempts, async () => {
        throw new Error("unavailable");
    });
    const switcher = group([primary, failing], ModelSwitchingStrategy.RoundRobin);
    expect((await switcher.chat(input())).text).toBe("a");
    expect((await switcher.chat(input())).text).toBe("a");
    expect(attempts).toEqual(["a", "a", "b", "a"]);
});

it("rotates fairly among available models while a breaker stays open", async () => {
    const attempts: string[] = [];
    const failed = new ExternalModel(
        "a",
        attempts,
        async () => {
            throw new Error("unavailable");
        },
        { circuitBreakerPolicy: { failureThreshold: 1, cooldownSeconds: 10 } },
    );
    const switcher = group([failed, new ExternalModel("b", attempts), new ExternalModel("c", attempts)], ModelSwitchingStrategy.RoundRobin);
    expect((await switcher.chat(input())).text).toBe("b");
    expect(attempts).toEqual(["a", "b"]);
    attempts.length = 0;
    const replies: string[] = [];
    for (let i = 0; i < 4; i++) replies.push((await switcher.chat(input())).text);
    expect(replies).toEqual(["b", "c", "b", "c"]);
    expect(attempts).toEqual(replies);
});

it("reserves the next round-robin model before concurrent calls await a reply", async () => {
    const attempts: string[] = [];
    let release!: (value: GenerateTextResult) => void;
    const pending = new Promise<GenerateTextResult>((resolve) => {
        release = resolve;
    });
    const switcher = group(
        [new ExternalModel("a", attempts, () => pending), new ExternalModel("b", attempts), new ExternalModel("c", attempts)],
        ModelSwitchingStrategy.RoundRobin,
    );
    const requests = [switcher.chat(input()), switcher.chat(input()), switcher.chat(input())];
    try {
        expect(attempts).toEqual(["a", "b", "c"]);
    } finally {
        release(response("a"));
        await Promise.all(requests);
    }
});

it("keeps round-robin cursors local to each returned switcher", async () => {
    const attempts: string[] = [];
    const models = [new ExternalModel("a", attempts), new ExternalModel("b", attempts)];
    const first = group(models, ModelSwitchingStrategy.RoundRobin);
    const second = group(models, ModelSwitchingStrategy.RoundRobin);
    expect((await first.chat(input())).text).toBe("a");
    expect((await first.chat(input())).text).toBe("b");
    expect((await second.chat(input())).text).toBe("a");
});

it("rejects duplicate group names before changing task mappings", () => {
    const config: any = {
        providers: [{ name: "p", models: [{ modelId: "m", abilities: [] }] }],
        modelGroups: [
            { name: "same", models: [{ providerName: "p", modelId: "m" }] },
            { name: "same", models: [{ providerName: "p", modelId: "m" }] },
        ],
        task: { chat: "same" },
    };
    expect(() => (ModelService.prototype as any).validateConfig.call({ config, logger, ctx: { scope: { update: vi.fn<() => void>() } } })).toThrow(/重复/);
});

it("removes image parts when falling back to a text-only group without mutating the caller", async () => {
    const seen: any[] = [];
    const model = new ExternalModel("text", [], async () => response("ok"));
    const originalChat = model.chat.bind(model);
    model.chat = async (options) => {
        seen.push(options);
        return originalChat(options);
    };
    const request = imageInput();
    request.messages[0].content = [{ type: "text", text: "keep question" }, ...(request.messages[0].content as any[])];
    await group([model]).chat(request);
    expect(seen[0].messages[0].content).toEqual([{ type: "text", text: "keep question" }]);
    expect((request.messages[0].content as any[]).some((part) => part.type === "image_url")).toBe(true);
});

it.each([ModelSwitchingStrategy.Failover, ModelSwitchingStrategy.RoundRobin])(
    "keeps the same conversation payload across real model requests with %s",
    async (strategy) => {
        const { ChatModel } = await import("../src/model/chat-model");
        const bodies: any[] = [];
        const transport = async (_url: any, init: any) => {
            bodies.push(JSON.parse(init.body));
            return bodies.length === 1
                ? new Response('{"error":{"message":"unavailable"}}', { status: 503, headers: { "content-type": "application/json" } })
                : new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: {} }), {
                      headers: { "content-type": "application/json" },
                  });
        };
        const models = ["one", "two"].map(
            (id) =>
                new ChatModel(
                    ctx,
                    () => ({ baseURL: "https://test.invalid/", apiKey: "test", model: id }),
                    { modelId: id, abilities: [ModelAbility.Chat], parameters: { stream: false }, retryPolicy: { maxRetries: 0 } } as any,
                    transport as any,
                    logging,
                ),
        );
        const switcher = new ChatModelSwitcher(
            ctx,
            { name: "shared", strategy, models: models.map((m) => descriptor(m.id)) },
            (_provider, id) => models.find((m) => m.id === id)!,
            logging,
        );
        const messages: any[] = [
            { role: "system", content: "same persona" },
            { role: "user", content: "Earlier group history, tool observations and current question" },
        ];
        await switcher.chat({ messages, stream: false });
        await switcher.chat({ messages, stream: false });
        expect(new Set(bodies.map((body) => body.model)).size).toBe(2);
        expect(bodies.length).toBeGreaterThanOrEqual(3);
        for (const body of bodies) expect(body.messages).toEqual(messages);
    },
);

it("keeps image-only inputs nonempty when using a text-only group", async () => {
    let received: any;
    const model = new ExternalModel("text", [], async () => response("ok"));
    const originalChat = model.chat.bind(model);
    model.chat = async (options) => {
        received = options;
        return originalChat(options);
    };
    await group([model]).chat(imageInput());
    expect(received.messages[0].content).toBe("[图片：当前模型不支持识图]");
});

it("preserves non-image assistant content during text-only fallback", async () => {
    let received: any;
    const model = new ExternalModel("text", [], async () => response("ok"));
    const originalChat = model.chat.bind(model);
    model.chat = async (options) => {
        received = options;
        return originalChat(options);
    };
    const request = imageInput();
    request.messages.push({ role: "assistant", content: [] });
    await group([model]).chat(request);
    expect(received.messages[1]).toEqual({ role: "assistant", content: [] });
});
