import { expect, it, vi } from "vitest";

import { ChatModel } from "../src/model/chat-model";
import { ModelAbility, ContentFailureAction } from "../src/model/config";
import { ChatModelSwitcher } from "../src/model/service";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

const baseURL = "https://example.test/api/";
const ctx = stubCtx();
const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    success() {},
    extend() {
        return this;
    },
};
const logging = loggingStub(logger);
const messages = [{ role: "user" as const, content: "test" }];
const call = { index: 0, id: "demo", type: "function", function: { name: "lookup", arguments: "{}" } };
const frame = (delta: any, finish_reason: string | null = null) => "data: " + JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] }) + "\n\n";
const sse = (body: ReadableStream | string) => new Response(body, { headers: { "content-type": "text/event-stream" } });
function model(fetch: any, stream: boolean) {
    return new ChatModel(
        ctx,
        () => ({ baseURL, apiKey: "fake", model: "test" }),
        {
            modelId: "test",
            abilities: [ModelAbility.Chat],
            parameters: { stream },
            timeoutPolicy: { firstTokenTimeout: 0.06, totalTimeout: 5 },
            retryPolicy: { maxRetries: 1, onContentFailure: ContentFailureAction.AugmentAndRetry },
        },
        fetch,
        logging,
    );
}
function group(m: ChatModel) {
    return new ChatModelSwitcher(ctx, { name: "g", models: [{ providerName: "test", modelId: "test" }] }, () => m, logging);
}
for (const stream of [false, true])
    for (const reason of ["length", "content_filter"])
        it("rejects tool call on " + reason + " streaming=" + stream, async () => {
            const m = model(
                async () =>
                    stream
                        ? sse(frame({ tool_calls: [call] }) + frame({}, reason))
                        : Response.json({ choices: [{ message: { role: "assistant", content: "", tool_calls: [call] }, finish_reason: reason }] }),
                stream,
            );
            await expect(m.chat({ messages, singleStep: true })).rejects.toThrow(reason);
        });
it("ignores semantic data after DONE regardless of chunk boundaries", async () => {
    const parts = [frame({ content: "one" }) + "data: [DONE]\n\n", frame({ content: "two" })];
    const fetch = () =>
        sse(
            new ReadableStream({
                start(c) {
                    for (const p of parts) c.enqueue(new TextEncoder().encode(p));
                    c.close();
                },
            }),
        );
    expect((await model(fetch, true).chat({ messages, singleStep: true })).text).toBe("one");
    expect((await model(() => sse(parts.join("")), true).chat({ messages, singleStep: true })).text).toBe("one");
});
it("clears first-token timer when singleStep receives an immediate tool delta", async () => {
    const fetch = vi.fn(async () =>
        sse(
            new ReadableStream({
                start(c) {
                    c.enqueue(new TextEncoder().encode(frame({ tool_calls: [call] })));
                    setTimeout(() => {
                        c.enqueue(new TextEncoder().encode(frame({}, "tool_calls")));
                        c.close();
                    }, 130);
                },
            }),
        ),
    );
    const m = model(fetch, true);
    m.config.retryPolicy!.maxRetries = 0;
    await expect(group(m).chat({ messages, singleStep: true })).resolves.toMatchObject({ finishReason: "tool_calls" });
    expect(fetch).toHaveBeenCalledOnce();
});
