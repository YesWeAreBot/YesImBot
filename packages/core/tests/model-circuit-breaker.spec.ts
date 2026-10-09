import type { GenerateTextResult } from "@xsai/generate-text";
import type { Context } from "koishi";
// Build the core package before running this integration test.
import { afterEach, expect, it, vi, type MockInstance } from "vitest";

import { BaseModel } from "../src/services/model/base-model";
import type { ChatRequestOptions, IChatModel } from "../src/services/model/chat-model";
import { ModelAbility } from "../src/services/model/config";
import { ChatModelSwitcher } from "../src/services/model/service";
import { Services } from "../src/shared/constants";

const logger = { extend: () => logger, debug() {}, info() {}, success() {}, warn() {}, error() {} };
const ctx = { [Services.Logger]: { getLogger: () => logger } } as unknown as Context;
const options = (abortSignal?: AbortSignal): ChatRequestOptions => ({ messages: [{ role: "user", content: "hello" }], abortSignal });
const response = (text: string): GenerateTextResult => ({
    text,
    finishReason: "stop",
    messages: [{ role: "assistant", content: text }],
    steps: [],
    toolCalls: [],
    toolResults: [],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});
const failure = async () => {
    throw new Error("provider unavailable");
};

// Only the external model call is simulated; admission, retries and failover run through the real switcher.
class ExternalModel extends BaseModel implements IChatModel {
    attempts = 0;
    constructor(
        id: string,
        threshold: number,
        public reply: (options: ChatRequestOptions) => Promise<GenerateTextResult>,
    ) {
        super(
            ctx,
            {
                modelId: id,
                abilities: [ModelAbility.Chat],
                circuitBreakerPolicy: { failureThreshold: threshold, cooldownSeconds: 10 },
                timeoutPolicy: { firstTokenTimeout: 60, totalTimeout: 60 },
            },
            "test",
        );
    }
    isVisionModel() {
        return false;
    }
    async chat(options: ChatRequestOptions) {
        this.attempts++;
        options.onStreamStart?.();
        return this.reply(options);
    }
}

function switcher(entries: Array<{ provider: string; model: ExternalModel }>) {
    let index = 0;
    return new ChatModelSwitcher(
        ctx,
        {
            name: "test",
            models: entries.map(({ provider, model }) => ({ providerName: provider, modelId: model.id })),
        },
        () => entries[index++].model,
    );
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

let clock: MockInstance | undefined;
function controlledClock() {
    let now = 1000;
    clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    return {
        cooldown: () => {
            now += 10001;
        },
    };
}
afterEach(() => {
    clock?.mockRestore();
    clock = undefined;
});

it("keeps a healthy provider available when another provider with the same model id opens", async () => {
    const a = new ExternalModel("shared", 1, failure);
    const b = new ExternalModel("shared", 1, async () => response("B healthy"));
    const group = switcher([
        { provider: "A", model: a },
        { provider: "B", model: b },
    ]);
    expect((await group.chat(options())).text).toBe("B healthy");
    expect((await group.chat(options())).text).toBe("B healthy");
    expect(a.attempts).toBe(1);
    expect(b.attempts).toBe(2);
});

it("applies each provider's own failure threshold for the same model id", async () => {
    const a = new ExternalModel("shared", 2, failure);
    const b = new ExternalModel("shared", 1, failure);
    const group = switcher([
        { provider: "A", model: a },
        { provider: "B", model: b },
    ]);
    for (let i = 0; i < 3; i++) await expect(group.chat(options())).rejects.toMatchObject({ code: "MODEL.ALL_FAILED_IN_GROUP" });
    expect(a.attempts).toBe(2);
    expect(b.attempts).toBe(1);
});

it("does not collide when provider names and model ids contain separators", async () => {
    const a = new ExternalModel("c", 1, failure);
    const b = new ExternalModel("b/c", 1, async () => response("B healthy"));
    const group = switcher([
        { provider: "a/b", model: a },
        { provider: "a", model: b },
    ]);
    expect((await group.chat(options())).text).toBe("B healthy");
    expect((await group.chat(options())).text).toBe("B healthy");
    expect(a.attempts).toBe(1);
});

it("shares the first breaker policy for repeated references to the same provider and model", async () => {
    const first = new ExternalModel("shared", 1, failure);
    const duplicate = new ExternalModel("shared", 3, async () => response("duplicate"));
    const group = switcher([
        { provider: "A", model: first },
        { provider: "A", model: duplicate },
    ]);
    await expect(group.chat(options())).rejects.toMatchObject({ code: "MODEL.ALL_FAILED_IN_GROUP" });
    expect(first.attempts).toBe(1);
    expect(duplicate.attempts).toBe(0);
});

it("admits one half-open probe and sends concurrent requests to the fallback until success", async () => {
    const time = controlledClock();
    const probe = deferred<GenerateTextResult>();
    const a = new ExternalModel("A", 1, failure);
    const b = new ExternalModel("B", 1, async () => response("fallback"));
    const group = switcher([
        { provider: "A", model: a },
        { provider: "B", model: b },
    ]);
    await group.chat(options());
    time.cooldown();
    a.reply = async () => (a.attempts === 2 ? probe.promise : response("unexpected second probe"));
    const probing = group.chat(options());
    try {
        expect((await group.chat(options())).text).toBe("fallback");
        expect(a.attempts).toBe(2);
    } finally {
        probe.resolve(response("recovered"));
    }
    expect((await probing).text).toBe("recovered");
    a.reply = async () => response("healthy");
    expect((await group.chat(options())).text).toBe("healthy");
});

it("returns the normal all-failed error while the only model has a probe in flight", async () => {
    const time = controlledClock();
    const probe = deferred<GenerateTextResult>();
    const a = new ExternalModel("A", 1, failure);
    const group = switcher([{ provider: "A", model: a }]);
    await expect(group.chat(options())).rejects.toMatchObject({ code: "MODEL.ALL_FAILED_IN_GROUP" });
    time.cooldown();
    a.reply = async () => (a.attempts === 2 ? probe.promise : response("unexpected second probe"));
    const probing = group.chat(options());
    try {
        await expect(group.chat(options())).rejects.toMatchObject({ code: "MODEL.ALL_FAILED_IN_GROUP" });
    } finally {
        probe.resolve(response("recovered"));
    }
    expect((await probing).text).toBe("recovered");
});

it("reopens after a failed probe and allows a new probe after another cooldown", async () => {
    const time = controlledClock();
    const a = new ExternalModel("A", 1, failure);
    const b = new ExternalModel("B", 1, async () => response("fallback"));
    const group = switcher([
        { provider: "A", model: a },
        { provider: "B", model: b },
    ]);
    await group.chat(options());
    time.cooldown();
    expect((await group.chat(options())).text).toBe("fallback");
    expect((await group.chat(options())).text).toBe("fallback");
    expect(a.attempts).toBe(2);
    time.cooldown();
    a.reply = async () => response("recovered");
    expect((await group.chat(options())).text).toBe("recovered");
});

it("releases a cancelled half-open probe without treating caller cancellation as failure", async () => {
    const time = controlledClock();
    const a = new ExternalModel("A", 1, failure);
    const group = switcher([{ provider: "A", model: a }]);
    await expect(group.chat(options())).rejects.toMatchObject({ code: "MODEL.ALL_FAILED_IN_GROUP" });
    time.cooldown();
    const entered = deferred<void>();
    a.reply = async ({ abortSignal }) =>
        new Promise((_, reject) => {
            abortSignal!.addEventListener("abort", () => reject(abortSignal!.reason), { once: true });
            entered.resolve();
        });
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    const probing = group.chat(options(controller.signal));
    const cancelled = probing.then(
        () => {
            throw new Error("expected caller cancellation");
        },
        (error) => error,
    );
    await entered.promise;
    controller.abort(reason);
    expect(await cancelled).toBe(reason);
    a.reply = async () => response("replacement probe");
    expect((await group.chat(options())).text).toBe("replacement probe");
});

it("ignores completion of an old closed-state request while a recovery probe is running", async () => {
    const time = controlledClock();
    const old = deferred<GenerateTextResult>();
    const probe = deferred<GenerateTextResult>();
    const a = new ExternalModel("A", 1, async () => old.promise);
    const b = new ExternalModel("B", 1, async () => response("fallback"));
    const group = switcher([
        { provider: "A", model: a },
        { provider: "B", model: b },
    ]);
    const pending = group.chat(options());
    a.reply = failure;
    await group.chat(options());
    time.cooldown();
    a.reply = async () => (a.attempts === 3 ? probe.promise : response("unexpected second probe"));
    const probing = group.chat(options());
    old.resolve(response("old success"));
    expect((await pending).text).toBe("old success");
    try {
        expect((await group.chat(options())).text).toBe("fallback");
    } finally {
        probe.resolve(response("recovered"));
    }
    await probing;
});
