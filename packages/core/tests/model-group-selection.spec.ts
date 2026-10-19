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
