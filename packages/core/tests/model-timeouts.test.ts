import { expect, it } from "bun:test";

import { ChatModel } from "../src/services/model/chat-model";
import { ModelAbility } from "../src/services/model/config";
import { ChatModelSwitcher } from "../src/services/model/service";
import { Services } from "../src/shared/constants";
import { AppError, ErrorDefinitions } from "../src/shared/errors";

const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
const frame = (delta: any, finish_reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }], usage })}\n\n`;

function fixture(configStream?: boolean, firstTokenTimeout: number | null = 0.025, totalTimeout = 0.5, responseDelay = 75, streamTailDelay = 0) {
    const logger: any = { extend: () => logger };
    for (const level of ["debug", "info", "warn", "error", "success"]) logger[level] = () => {};
    const ctx: any = { [Services.Logger]: { getLogger: () => logger } };
    const streams: boolean[] = [];
    const fetch = (async (_url, init) => {
        const stream = JSON.parse(init!.body as string).stream;
        streams.push(stream);
        await new Promise<void>((resolve, reject) => {
            const signal = init!.signal!;
            signal.throwIfAborted();
            const onAbort = () => {
                clearTimeout(timer);
                reject(signal.reason);
            };
            const timer = setTimeout(() => {
                signal.removeEventListener("abort", onAbort);
                resolve();
            }, responseDelay);
            signal.addEventListener("abort", onAbort, { once: true });
        });
        if (stream) {
            const encoder = new TextEncoder();
            return new Response(
                new ReadableStream({
                    start(controller) {
                        const signal = init!.signal!;
                        signal.throwIfAborted();
                        controller.enqueue(encoder.encode(frame({ content: "reply" })));
                        const onAbort = () => {
                            clearTimeout(timer);
                            controller.error(signal.reason);
                        };
                        const timer = setTimeout(() => {
                            signal.removeEventListener("abort", onAbort);
                            controller.enqueue(encoder.encode(frame({}, "stop") + "data: [DONE]\n\n"));
                            controller.close();
                        }, streamTailDelay);
                        signal.addEventListener("abort", onAbort, { once: true });
                    },
                }),
                { headers: { "content-type": "text/event-stream" } },
            );
        }
        return new Response(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: "reply" }, finish_reason: "stop" }], usage }), {
            headers: { "content-type": "application/json" },
        });
    }) as typeof globalThis.fetch;
    const model = new ChatModel(
        ctx,
        (model) => ({ model, baseURL: "https://timeout.invalid/v1/", apiKey: "test" }),
        {
            modelId: "test",
            abilities: [ModelAbility.Chat],
            parameters: { stream: configStream },
            timeoutPolicy: { firstTokenTimeout: firstTokenTimeout ?? undefined, totalTimeout },
            retryPolicy: { maxRetries: 0 },
        },
        fetch,
    );
    const switcher = new ChatModelSwitcher(ctx, { name: "test", models: [{ providerName: "test", modelId: "test" }] }, () => model);
    return { switcher, streams };
}

it("allows a runtime non-stream request to finish after the first-token deadline", async () => {
    const { switcher, streams } = fixture(true);
    expect((await switcher.chat({ messages: [], stream: false })).text).toBe("reply");
    expect(streams).toEqual([false]);
});

it("allows a configured non-stream single-step request to finish after the first-token deadline", async () => {
    const { switcher, streams } = fixture(false);
    expect((await switcher.chat({ messages: [], singleStep: true })).text).toBe("reply");
    expect(streams).toEqual([false]);
});

for (const [configStream, runtimeStream] of [
    [false, true],
    [true, undefined],
    [undefined, undefined],
] as const) {
    it(`keeps first-token timeouts for streaming requests (configured=${configStream}, runtime=${runtimeStream})`, async () => {
        const { switcher, streams } = fixture(configStream);
        try {
            await switcher.chat({ messages: [], stream: runtimeStream });
            throw new Error("The delayed stream incorrectly succeeded");
        } catch (error) {
            expect(error).toBeInstanceOf(AppError);
            const failure = (error as AppError).context.accumulatedErrors[0].error as AppError;
            expect(failure.code).toBe(ErrorDefinitions.LLM.TIMEOUT.code);
            expect((failure.cause as Error).message).toContain("First token");
        }
        expect(streams).toEqual([true]);
    });
}

it("keeps the total timeout for non-streaming requests", async () => {
    const { switcher } = fixture(false, 0.01, 0.04, 100);
    try {
        await switcher.chat({ messages: [] });
        throw new Error("The overdue non-stream request incorrectly succeeded");
    } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const failure = (error as AppError).context.accumulatedErrors[0].error as AppError;
        expect(failure.code).toBe(ErrorDefinitions.LLM.TIMEOUT.code);
        expect((failure.cause as Error).message).toContain("Request timed out");
    }
});

it("allows streaming when only a total timeout is configured", async () => {
    const { switcher } = fixture(true, null);
    expect((await switcher.chat({ messages: [] })).text).toBe("reply");
});

it("clears the streaming first-token timer after receiving content", async () => {
    const { switcher } = fixture(true, 0.025, 0.5, 0, 75);
    expect((await switcher.chat({ messages: [] })).text).toBe("reply");
});

it("keeps the streaming total timeout after receiving content", async () => {
    const { switcher } = fixture(true, 0.025, 0.04, 0, 100);
    try {
        await switcher.chat({ messages: [] });
        throw new Error("The overdue stream incorrectly succeeded");
    } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        const failure = (error as AppError).context.accumulatedErrors[0].error as AppError;
        expect(failure.code).toBe(ErrorDefinitions.LLM.TIMEOUT.code);
        expect((failure.cause as Error).message).toContain("Request timed out");
    }
});
