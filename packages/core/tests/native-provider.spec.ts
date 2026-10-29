import { streamText } from "@xsai/stream-text";
import { describe, expect, it } from "vitest";

import { createNativeFetch } from "../src/model/native-fetch";

const config = (protocol: string) =>
    ({
        protocol,
        type: protocol === "gemini-native" ? "Google Gemini" : "Anthropic",
        apiKey: "secret",
        baseURL: protocol === "gemini-native" ? "https://example.test/v1beta/" : "https://example.test/v1/",
    }) as any;
const json = (data: unknown) => Response.json(data);
const response = {
    candidates: [{ content: { parts: [{ text: "你好" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 3, cachedContentTokenCount: 1, totalTokenCount: 9 },
};
const call = (fetch: typeof globalThis.fetch, body: any = {}, base = "v1beta") =>
    fetch(`https://example.test/${base}/chat/completions`, {
        method: "POST",
        body: JSON.stringify({
            model: "test",
            messages: [
                { role: "system", content: "rules" },
                { role: "user", content: "hello" },
            ],
            ...body,
        }),
    });
function transport(result: () => Response) {
    const calls: any[] = [];
    return {
        calls,
        fetch: (async (url, init) => {
            calls.push({ url: String(url), init, body: init?.body ? JSON.parse(String(init.body)) : undefined });
            return result();
        }) as typeof globalThis.fetch,
    };
}
function sse(events: any[], fragmented = false) {
    const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
    let offset = 0;
    return new Response(
        new ReadableStream({
            pull(c) {
                if (offset === bytes.length) return c.close();
                const size = fragmented ? 1 : bytes.length;
                c.enqueue(bytes.slice(offset, (offset += size)));
            },
        }),
        { headers: { "content-type": "text/event-stream" } },
    );
}

describe("native provider requests", () => {
    it("leaves compatible transport untouched", () => {
        const f = transport(() => json({})).fetch;
        expect(createNativeFetch({ protocol: "openai-compatible" } as any, f)).toBe(f);
    });
    it("uses native Gemini chat, system and usage", async () => {
        const t = transport(() => json(response));
        const out = await (await call(createNativeFetch(config("gemini-native"), t.fetch))).json();
        expect(t.calls[0].url).toBe("https://example.test/v1beta/models/test:generateContent");
        expect(t.calls[0].init.headers.get("x-goog-api-key")).toBe("secret");
        expect(t.calls[0].body.systemInstruction.parts[0].text).toBe("rules");
        expect(out.choices[0].message.content).toBe("你好");
        expect(out.usage).toMatchObject({ prompt_tokens: 4, completion_tokens: 5, total_tokens: 9, prompt_tokens_details: { cached_tokens: 1 } });
    });
    it("uses Anthropic messages and normalizes cached usage", async () => {
        const t = transport(() =>
            json({
                id: "a",
                content: [{ type: "text", text: "hi" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 4, cache_creation_input_tokens: 5 },
            }),
        );
        const out = await (await call(createNativeFetch(config("anthropic-native"), t.fetch), {}, "v1")).json();
        expect(t.calls[0].url).toBe("https://example.test/v1/messages");
        expect(t.calls[0].init.headers.get("x-api-key")).toBe("secret");
        expect(t.calls[0].init.headers.get("authorization")).toBeNull();
        expect(t.calls[0].body.system).toEqual([{ type: "text", text: "rules" }]);
        expect(out.usage.prompt_tokens).toBe(12);
        expect(out.usage.completion_tokens).toBe(2);
    });
    it("preserves Gemini tool-call signatures across result continuation", async () => {
        const t = transport(() =>
            json({
                candidates: [
                    {
                        content: { parts: [{ functionCall: { name: "lookup", args: { q: "x" }, id: "native-id" }, thoughtSignature: "opaque-signature" }] },
                        finishReason: "STOP",
                    },
                ],
            }),
        );
        const f = createNativeFetch(config("gemini-native"), t.fetch);
        const out = await (await call(f)).json();
        const tool = out.choices[0].message.tool_calls[0];
        await call(f, {
            messages: [
                { role: "assistant", content: "", tool_calls: [tool] },
                { role: "tool", tool_call_id: tool.id, content: "result" },
            ],
        });
        expect(t.calls[1].body.contents[0].parts[0].thoughtSignature).toBe("opaque-signature");
        expect(t.calls[1].body.contents[1].parts[0].functionResponse).toMatchObject({ id: "native-id", name: "lookup", response: { result: "result" } });
    });
    it("preserves Anthropic signed thinking around tool results", async () => {
        const thinking = { type: "thinking", thinking: "thought", signature: "sig" };
        const t = transport(() =>
            json({ id: "a", content: [thinking, { type: "tool_use", id: "tool_1", name: "lookup", input: { q: "x" } }], stop_reason: "tool_use", usage: {} }),
        );
        const f = createNativeFetch(config("anthropic-native"), t.fetch);
        const out = await (await call(f, {}, "v1")).json();
        const tool = out.choices[0].message.tool_calls[0];
        await call(
            f,
            {
                messages: [
                    { role: "assistant", content: "", tool_calls: [tool] },
                    { role: "tool", tool_call_id: tool.id, content: "ok" },
                ],
            },
            "v1",
        );
        expect(t.calls[1].body.messages[0].content[0]).toEqual(thinking);
        expect(t.calls[1].body.messages[1].content[0].tool_use_id).toBe("tool_1");
    });
    it("converts base64 images, rejects unsupported audio", async () => {
        const t = transport(() => json(response));
        const f = createNativeFetch(config("gemini-native"), t.fetch);
        await call(f, { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }] }] });
        expect(t.calls[0].body.contents[0].parts[0].inlineData).toEqual({ mimeType: "image/png", data: "aGVsbG8=" });
        await expect(call(f, { messages: [{ role: "user", content: [{ type: "input_audio", input_audio: {} }] }] })).rejects.toThrow(/不支持|unsupported/i);
    });
    it("does not silently discard incompatible controls", async () => {
        const t = transport(() => json(response));
        await expect(call(createNativeFetch(config("gemini-native"), t.fetch), { logit_bias: { "1": 1 } })).rejects.toThrow(/logit_bias/);
        expect(t.calls).toHaveLength(0);
    });
    it("passes abort and HTTP failures through", async () => {
        const controller = new AbortController();
        const t = transport(() => new Response("denied", { status: 429 }));
        const f = createNativeFetch(config("gemini-native"), t.fetch);
        const r = await f("https://example.test/v1beta/chat/completions", {
            method: "POST",
            signal: controller.signal,
            body: JSON.stringify({ model: "test", messages: [] }),
        });
        expect(r.status).toBe(429);
        expect(await r.text()).toBe("denied");
        expect(t.calls[0].init.signal).toBe(controller.signal);
    });
    it("uses native batch embeddings and returns vectors in order", async () => {
        const t = transport(() => json({ embeddings: [{ values: [1, 2] }, { values: [3, 4] }] }));
        const f = createNativeFetch(config("gemini-native"), t.fetch);
        const r = await f("https://example.test/v1beta/embeddings", {
            method: "POST",
            body: JSON.stringify({ model: "models/embed-test", input: ["one", "two"], dimensions: 2 }),
        });
        expect(t.calls[0].url).toBe("https://example.test/v1beta/models/embed-test:batchEmbedContents");
        expect(t.calls[0].body.requests[0]).toMatchObject({ model: "models/embed-test", content: { parts: [{ text: "one" }] }, outputDimensionality: 2 });
        expect((await r.json()).data.map((x: any) => x.embedding)).toEqual([
            [1, 2],
            [3, 4],
        ]);
    });
    it("uses the provider type even when an obsolete saved protocol field disagrees", async () => {
        const t = transport(() => json(response));
        const f = createNativeFetch({ ...config("gemini-native"), protocol: "openai-compatible" }, t.fetch);
        await call(f);
        expect(t.calls[0].url).toContain(":generateContent");
    });
    it("keeps explicitly compatible Gemini gateways on their configured chat endpoint", async () => {
        const t = transport(() => json({}));
        const f = createNativeFetch({ ...config("gemini-native"), type: "OpenAI Compatible" }, t.fetch);
        await call(f);
        expect(t.calls[0].url).toBe("https://example.test/v1beta/chat/completions");
    });
    it("authenticates metadata without pretending input limit is total context", async () => {
        const t = transport(() => json({ models: [{ name: "models/test", inputTokenLimit: 100 }] }));
        const f = createNativeFetch(config("gemini-native"), t.fetch);
        const r = await f("https://example.test/v1beta/models", { method: "GET" });
        expect(t.calls[0].init.headers.get("x-goog-api-key")).toBe("secret");
        expect((await r.json()).models[0].inputTokenLimit).toBe(100);
    });
});

describe("native streaming", () => {
    it("streams fragmented unicode through the actual xsai consumer", async () => {
        const t = transport(() =>
            sse(
                [
                    { candidates: [{ content: { parts: [{ text: "你" }] } }] },
                    {
                        candidates: [{ content: { parts: [{ text: "好" }] }, finishReason: "STOP" }],
                        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
                    },
                ],
                true,
            ),
        );
        const stream = await streamText({
            baseURL: "https://example.test/v1beta/",
            apiKey: "secret",
            model: "test",
            messages: [{ role: "user", content: "hi" }],
            fetch: createNativeFetch(config("gemini-native"), t.fetch),
        });
        let text = "";
        for await (const chunk of stream.textStream) text += chunk;
        expect(text).toBe("你好");
        expect((await stream.usage)?.total_tokens).toBe(3);
        expect(t.calls[0].url).toBe("https://example.test/v1beta/models/test:streamGenerateContent?alt=sse");
    });
    it("translates Anthropic tool argument deltas and usage", async () => {
        const t = transport(() =>
            sse(
                [
                    { type: "message_start", message: { id: "a", usage: { input_tokens: 4, output_tokens: 0 } } },
                    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call-1", name: "lookup", input: {} } },
                    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"q":' } },
                    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"你好"}' } },
                    { type: "content_block_stop", index: 0 },
                    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
                    { type: "message_stop" },
                ],
                true,
            ),
        );
        const r = await call(createNativeFetch(config("anthropic-native"), t.fetch), { stream: true }, "v1");
        const chunks = (await r.text())
            .split("\n")
            .filter((x) => x.startsWith("data: {"))
            .map((x) => JSON.parse(x.slice(6)));
        const tool = chunks.flatMap((x) => x.choices?.[0]?.delta?.tool_calls ?? [])[0];
        expect(JSON.parse(tool.function.arguments)).toEqual({ q: "你好" });
        expect(chunks.find((x) => x.usage)?.usage).toMatchObject({ prompt_tokens: 4, completion_tokens: 5 });
    });
    it("reports in-band native errors instead of successful empty output", async () => {
        const t = transport(() => sse([{ error: { message: "quota exceeded" } }]));
        const r = await call(createNativeFetch(config("gemini-native"), t.fetch), { stream: true });
        await expect(r.text()).rejects.toThrow(/quota exceeded/);
    });
    it("rejects a truncated stream lacking its finish event", async () => {
        const t = transport(() => sse([{ candidates: [{ content: { parts: [{ text: "partial" }] } }] }]));
        const r = await call(createNativeFetch(config("gemini-native"), t.fetch), { stream: true });
        await expect(r.text()).rejects.toThrow(/截断|结束|finish/i);
    });
    it("cancels the upstream body when the caller cancels", async () => {
        let cancelled = false;
        const t = transport(
            () =>
                new Response(
                    new ReadableStream({
                        cancel() {
                            cancelled = true;
                        },
                    }),
                ),
        );
        const r = await call(createNativeFetch(config("gemini-native"), t.fetch), { stream: true });
        await r.body!.cancel();
        expect(cancelled).toBe(true);
    });
});

import { ChatModel } from "../src/model/chat-model";
import { ModelAbility } from "../src/model/config";
import { EmbedModel } from "../src/model/embed-model";
import { loggingStub, stubCtx } from "./helpers/yesimbot";

function chatModel(protocol: string, fetch: typeof globalThis.fetch, stream: boolean) {
    const c = config(protocol);
    return new ChatModel(
        stubCtx(),
        () => ({ baseURL: c.baseURL, apiKey: c.apiKey, model: "test" }),
        { modelId: "test", abilities: [ModelAbility.Chat], parameters: { stream } },
        createNativeFetch(c, fetch),
        loggingStub(),
    );
}
for (const stream of [false, true]) {
    it(`ChatModel returns native Gemini text and usage (${stream ? "SSE" : "JSON"})`, async () => {
        const t = transport(() => (stream ? sse([response], true) : json(response)));
        const model = chatModel("gemini-native", t.fetch, stream);
        const result = await model.chat({ messages: [{ role: "user", content: "hello" }] });
        expect(result.text).toBe("你好");
        expect(result.usage).toMatchObject({ prompt_tokens: 4, completion_tokens: 5 });
    });
    it(`ChatModel preserves native Anthropic single-step tool execution boundary (${stream ? "SSE" : "JSON"})`, async () => {
        const native = {
            id: "a",
            content: [{ type: "tool_use", id: "call_1", name: "lookup", input: { q: "hello" } }],
            usage: { input_tokens: 3, output_tokens: 4 },
            stop_reason: "tool_use",
        };
        const t = transport(() =>
            stream
                ? sse([
                      { type: "message_start", message: native },
                      { type: "content_block_start", index: 0, content_block: native.content[0] },
                      { type: "content_block_stop", index: 0 },
                      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: native.usage },
                      { type: "message_stop" },
                  ])
                : json(native),
        );
        let calls = 0;
        const model = chatModel("anthropic-native", t.fetch, stream);
        const result = await model.chat({
            singleStep: true,
            messages: [{ role: "user", content: "hello" }],
            tools: [
                {
                    type: "function",
                    function: { name: "lookup", parameters: { type: "object", properties: { q: { type: "string" } } } },
                    execute: () => {
                        calls++;
                        return {};
                    },
                },
            ],
        });
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].toolName).toBe("lookup");
        // Existing xsai execution behavior is unchanged; the native bridge itself adds no execution.
        expect(calls).toBe(1);
        expect(result.usage).toMatchObject({ prompt_tokens: 3, completion_tokens: 4 });
    });
}
it("EmbedModel consumes native Gemini batch vectors", async () => {
    const c = config("gemini-native");
    const t = transport(() => json({ embeddings: [{ values: [1, 2] }, { values: [3, 4] }] }));
    const model = new EmbedModel(
        stubCtx(),
        () => ({ baseURL: c.baseURL, apiKey: c.apiKey, model: "test" }),
        { modelId: "test", abilities: [ModelAbility.Embedding] },
        createNativeFetch(c, t.fetch),
        loggingStub(),
    );
    expect((await model.embedMany(["one", "two"])).embeddings).toEqual([
        [1, 2],
        [3, 4],
    ]);
});
it("rejects simultaneous Anthropic sampling controls before sending", async () => {
    const t = transport(() => json({}));
    await expect(call(createNativeFetch(config("anthropic-native"), t.fetch), { temperature: 0.85, top_p: 0.95 }, "v1")).rejects.toThrow(/temperature.*top_p/);
    expect(t.calls).toHaveLength(0);
});
it("delivers a native text chunk before upstream EOF", async () => {
    let close!: () => void;
    const first = new TextEncoder().encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "early" }] } }] })}\n\n`);
    const t = transport(
        () =>
            new Response(
                new ReadableStream({
                    start(c) {
                        c.enqueue(first);
                        close = () => {
                            c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ candidates: [{ finishReason: "STOP" }] })}\n\n`));
                            c.close();
                        };
                    },
                }),
                { headers: { "content-type": "text/event-stream" } },
            ),
    );
    const response = await call(createNativeFetch(config("gemini-native"), t.fetch), { stream: true });
    const reader = response.body!.getReader();
    const early = await reader.read();
    expect(new TextDecoder().decode(early.value)).toContain("early");
    close();
    while (!(await reader.read()).done) {
        /* drain */
    }
});
it("fails rather than pretending unsupported strict Gemini tool schemas are enforced", async () => {
    const t = transport(() => json(response));
    await expect(
        call(createNativeFetch(config("gemini-native"), t.fetch), {
            tools: [{ type: "function", function: { name: "lookup", parameters: {}, strict: true } }],
        }),
    ).rejects.toThrow(/strict/);
    expect(t.calls).toHaveLength(0);
});
it("does not turn native malformed-function termination into success", async () => {
    const t = transport(() => json({ candidates: [{ content: { parts: [{ text: "partial" }] }, finishReason: "MALFORMED_FUNCTION_CALL" }] }));
    await expect(call(createNativeFetch(config("gemini-native"), t.fetch))).rejects.toThrow(/MALFORMED_FUNCTION_CALL/);
});

for (const stream of [false, true]) {
    for (const nativeId of [undefined, "native-call-id"]) {
        it(`preserves Gemini ${nativeId ? "supplied" : "absent"} native function ID on signed ${stream ? "SSE" : "JSON"} continuation`, async () => {
            const nativeCall = { name: "lookup", args: { q: "x" }, ...(nativeId ? { id: nativeId } : {}) };
            const native = { candidates: [{ content: { parts: [{ functionCall: nativeCall, thoughtSignature: "signed-call" }] }, finishReason: "STOP" }] };
            const t = transport(() => (stream && t.calls.length === 1 ? sse([native], true) : json(native)));
            const f = createNativeFetch(config("gemini-native"), t.fetch);
            const response = await call(f, { stream });
            let tool: any;
            if (stream) {
                const chunks = (await response.text())
                    .split("\n")
                    .filter((line) => line.startsWith("data: {"))
                    .map((line) => JSON.parse(line.slice(6)));
                tool = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls ?? [])[0];
            } else tool = (await response.json()).choices[0].message.tool_calls[0];
            expect(typeof tool.id).toBe("string");
            expect(tool.id.length).toBeGreaterThan(0);
            const continuation = await call(f, {
                stream: false,
                messages: [
                    { role: "assistant", content: "", tool_calls: [tool] },
                    { role: "tool", tool_call_id: tool.id, content: "result" },
                ],
            });
            await continuation.body?.cancel();
            const payload = t.calls[1].body;
            expect(payload.contents[0].parts[0]).toEqual({ functionCall: nativeCall, thoughtSignature: "signed-call" });
            expect(payload.contents[1].parts[0].functionResponse).toEqual({
                name: "lookup",
                ...(nativeId ? { id: nativeId } : {}),
                response: { result: "result" },
            });
            expect(Object.hasOwn(payload.contents[1].parts[0].functionResponse, "id")).toBe(nativeId !== undefined);
        });
    }
}
it("assigns distinct internal IDs to identical ID-less Gemini calls without fabricating native IDs", async () => {
    const part = { functionCall: { name: "lookup", args: {} }, thoughtSignature: "signed" };
    const t = transport(() => json({ candidates: [{ content: { parts: [part, part] }, finishReason: "STOP" }] }));
    const f = createNativeFetch(config("gemini-native"), t.fetch);
    const tools = (await (await call(f)).json()).choices[0].message.tool_calls;
    expect(tools[0].id).not.toBe(tools[1].id);
    await call(f, {
        messages: [
            { role: "assistant", content: "", tool_calls: tools },
            ...tools.map((tool: any) => ({ role: "tool", tool_call_id: tool.id, content: "ok" })),
        ],
    });
    for (const part of t.calls[1].body.contents[1].parts) expect(part.functionResponse).not.toHaveProperty("id");
});

for (const protocol of ["gemini-native", "anthropic-native"]) {
    for (const complete of [true, false]) {
        it(`ChatModel sees ${protocol} tool activity before EOF and ${complete ? "executes only after completion" : "rejects a truncated tool response"}`, async () => {
            let finishSource!: () => void;
            const nativeStart =
                protocol === "gemini-native"
                    ? [{ candidates: [{ content: { parts: [{ functionCall: { name: "lookup", args: { q: "x" } }, thoughtSignature: "sig" }] } }] }]
                    : [
                          { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 0 } } },
                          { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call-1", name: "lookup", input: {} } },
                          { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"q":' } },
                          { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"x"}' } },
                      ];
            const nativeFinish =
                protocol === "gemini-native"
                    ? [{ candidates: [{ finishReason: "STOP" }] }]
                    : [
                          { type: "content_block_stop", index: 0 },
                          { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 2 } },
                          { type: "message_stop" },
                      ];
            const encoder = new TextEncoder();
            const frame = (event: any) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
            const upstream = new Response(
                new ReadableStream<Uint8Array>({
                    start(controller) {
                        for (const event of nativeStart) controller.enqueue(frame(event));
                        finishSource = () => {
                            if (complete) for (const event of nativeFinish) controller.enqueue(frame(event));
                            controller.close();
                        };
                    },
                }),
                { headers: { "content-type": "text/event-stream" } },
            );
            const t = transport(() => upstream);
            const model = chatModel(protocol, t.fetch, true);
            let starts = 0;
            let executions = 0;
            let notifyStarted!: () => void;
            const started = new Promise<boolean>((resolve) => {
                notifyStarted = () => resolve(true);
            });
            const pending = model.chat({
                singleStep: true,
                messages: [{ role: "user", content: "hi" }],
                onStreamStart: () => {
                    starts++;
                    notifyStarted();
                },
                tools: [
                    {
                        type: "function",
                        function: { name: "lookup", parameters: { type: "object", properties: { q: { type: "string" } } } },
                        execute: () => {
                            executions++;
                            return {};
                        },
                    },
                ],
            });
            let observed = false;
            try {
                observed = await Promise.race([started, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100))]);
                expect(executions).toBe(0);
            } finally {
                finishSource();
            }
            const outcome = await pending.then(
                (result) => ({ result, error: null }),
                (error) => ({ result: null, error }),
            );
            expect(outcome.error === null).toBe(complete);
            expect(outcome.result?.toolCalls?.length ?? 0).toBe(complete ? 1 : 0);
            expect(executions).toBe(complete ? 1 : 0);
            expect(outcome.error === null ? "" : String(outcome.error)).toMatch(complete ? /^$/ : /失败|截断|结束|EOF/);
            expect(observed).toBe(true);
            expect(starts).toBe(1);
        });
    }
}

for (const protocol of ["gemini-native", "anthropic-native"]) {
    for (const kind of ["text", "image_url", "input_audio"]) {
        it(`${protocol} ${kind === "text" || (protocol === "anthropic-native" && kind === "image_url") ? "translates" : "rejects"} ${kind} tool result parts`, async () => {
            const t = transport(() =>
                protocol === "gemini-native" ? json(response) : json({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: {} }),
            );
            const f = createNativeFetch(config(protocol), t.fetch);
            const content =
                kind === "text"
                    ? [
                          { type: "text", text: "one" },
                          { type: "text", text: "two" },
                      ]
                    : kind === "image_url"
                      ? [{ type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } }]
                      : [{ type: "input_audio", input_audio: { data: "aGVsbG8=", format: "wav" } }];
            const request = call(
                f,
                {
                    messages: [
                        {
                            role: "assistant",
                            content: "",
                            tool_calls: [{ id: "native-call", type: "function", function: { name: "lookup", arguments: "{}" } }],
                        },
                        { role: "tool", tool_call_id: "native-call", content },
                    ],
                },
                protocol === "gemini-native" ? "v1beta" : "v1",
            );
            const shouldReject = kind === "input_audio" || (protocol === "gemini-native" && kind === "image_url");
            const error = await request.then(
                () => null,
                (error) => error,
            );
            expect(error === null).toBe(!shouldReject);
            expect(error === null ? "" : String(error)).toMatch(shouldReject ? /不支持/ : /^$/);
            expect(t.calls).toHaveLength(shouldReject ? 0 : 1);
            const payload = t.calls[0]?.body;
            const actual = protocol === "gemini-native" ? payload?.contents[1].parts[0].functionResponse.response : payload?.messages[1].content[0].content;
            const expected = shouldReject
                ? undefined
                : protocol === "gemini-native"
                  ? { result: "onetwo" }
                  : kind === "text"
                    ? content
                    : [{ type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } }];
            expect(actual).toEqual(expected);
        });
    }
}
it("preserves raw caller-supplied Gemini tool IDs on both sides of a continuation", async () => {
    const t = transport(() => json(response));
    const f = createNativeFetch(config("gemini-native"), t.fetch);
    await call(f, {
        messages: [
            { role: "assistant", content: "", tool_calls: [{ id: "raw-call-id", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } }] },
            { role: "tool", tool_call_id: "raw-call-id", content: "ok" },
        ],
    });
    expect(t.calls[0].body.contents[0].parts[0].functionCall).toEqual({ id: "raw-call-id", name: "lookup", args: { q: "x" } });
    expect(t.calls[0].body.contents[1].parts[0].functionResponse.id).toBe("raw-call-id");
});

for (const protocol of ["gemini-native", "anthropic-native"]) {
    for (const stream of [false, true]) {
        for (const reason of protocol === "gemini-native" ? ["MAX_TOKENS", "SAFETY", undefined] : ["max_tokens", "refusal", "pause_turn"]) {
            it(`ChatModel never executes ${protocol} tool data after ${String(reason)} (${stream ? "SSE" : "JSON"})`, async () => {
                const gemini = {
                    candidates: [
                        { content: { parts: [{ functionCall: { name: "lookup", args: { q: "partial" } } }] }, ...(reason ? { finishReason: reason } : {}) },
                    ],
                };
                const anthropic = {
                    content: [{ type: "tool_use", id: "native-call", name: "lookup", input: { q: "partial" } }],
                    stop_reason: reason,
                    usage: {},
                };
                const events =
                    protocol === "gemini-native"
                        ? [gemini]
                        : [
                              { type: "message_start", message: { usage: {} } },
                              { type: "content_block_start", index: 0, content_block: anthropic.content[0] },
                              { type: "content_block_stop", index: 0 },
                              { type: "message_delta", delta: { stop_reason: reason }, usage: {} },
                              { type: "message_stop" },
                          ];
                const t = transport(() => (stream ? sse(events) : json(protocol === "gemini-native" ? gemini : anthropic)));
                const model = chatModel(protocol, t.fetch, stream);
                let executions = 0;
                await expect(
                    model.chat({
                        singleStep: true,
                        messages: [{ role: "user", content: "hi" }],
                        tools: [
                            {
                                type: "function",
                                function: { name: "lookup", parameters: { type: "object", properties: { q: { type: "string" } } } },
                                execute: () => {
                                    executions++;
                                    return {};
                                },
                            },
                        ],
                    }),
                ).rejects.toThrow(/./);
                expect(executions).toBe(0);
                expect(t.calls).toHaveLength(1);
            });
        }
    }
}
