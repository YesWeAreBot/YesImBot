import { expect, it } from "vitest";

import { ChatModel } from "../src/model/chat-model";
import { ModelAbility } from "../src/model/config";
import { createQwenFetch } from "../src/model/native/qwen";
import { loggingStub, stubCtx } from "./helpers/yesimbot";
const cfg = {
    type: "Qwen",
    name: "qwen",
    apiKey: "key",
    baseURL: "https://qwen.test/prefix/api/v1/",
    models: [{ modelId: "vision-custom-name", abilities: [ModelAbility.Chat, ModelAbility.Vision] }],
} as any;
const terminal = {
    output: { choices: [{ message: { role: "assistant", content: "你好" }, finish_reason: "stop" }] },
    usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
    request_id: "req",
};
function fixture(reply: () => Response) {
    const calls: any[] = [];
    const f = createQwenFetch(cfg, (async (url: any, init: any) => {
        calls.push({ url: String(url), init, body: init?.body && JSON.parse(init.body) });
        return reply();
    }) as any);
    return { f, calls };
}
const call = (f: typeof fetch, extra: any = {}) =>
    f(`${cfg.baseURL}chat/completions`, { method: "POST", body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "hi" }], ...extra }) });
function sse(events: any[]) {
    return new Response(events.map((x) => `data: ${JSON.stringify(x)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}
it("uses native DashScope text generation and parameters", async () => {
    const { f, calls } = fixture(() => Response.json(terminal));
    const result = await (await call(f, { temperature: 0.8, max_tokens: 20 })).json();
    expect(calls[0].url).toBe(`${cfg.baseURL}services/aigc/text-generation/generation`);
    expect(calls[0].body).toMatchObject({
        model: "test",
        input: { messages: [{ role: "user", content: "hi" }] },
        parameters: { result_format: "message", incremental_output: true, temperature: 0.8, max_tokens: 20 },
    });
    expect(calls[0].init.headers.get("authorization")).toBe("Bearer key");
    expect(result.choices[0].message.content).toBe("你好");
    expect(result.usage).toMatchObject({ prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 });
});
it("routes visual models by declared ability and converts image parts", async () => {
    const { f, calls } = fixture(() => Response.json(terminal));
    await call(f, {
        model: "vision-custom-name",
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: "look" },
                    { type: "image_url", image_url: { url: "https://image.test/x.png" } },
                ],
            },
        ],
    });
    expect(calls[0].url).toBe(`${cfg.baseURL}services/aigc/multimodal-generation/generation`);
    expect(calls[0].body.input.messages[0].content).toEqual([{ text: "look" }, { image: "https://image.test/x.png" }]);
    await expect(
        call(f, {
            model: "qwen-vl-guessed-name",
            messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://image.test/x.png" } }] }],
        }),
    ).rejects.toThrow(/视觉|图片/);
});
it("orders native embedding vectors and preserves actual input tokens", async () => {
    const { f, calls } = fixture(() =>
        Response.json({
            output: {
                embeddings: [
                    { text_index: 1, embedding: [2] },
                    { text_index: 0, embedding: [1] },
                ],
            },
            usage: { total_tokens: 5 },
        }),
    );
    const out = await (
        await f(`${cfg.baseURL}embeddings`, { method: "POST", body: JSON.stringify({ model: "embed", input: ["a", "b"], dimensions: 1 }) })
    ).json();
    expect(calls[0].url).toBe(`${cfg.baseURL}services/embeddings/text-embedding/text-embedding`);
    expect(calls[0].body).toEqual({ model: "embed", input: { texts: ["a", "b"] }, parameters: { dimension: 1 } });
    expect(out.data.map((x: any) => x.embedding)).toEqual([[1], [2]]);
    expect(out.usage.prompt_tokens).toBe(5);
});
it("preserves tool IDs/results and rejects media tool responses", async () => {
    const { f, calls } = fixture(() => Response.json(terminal));
    const messages = [
        { role: "assistant", content: "", tool_calls: [{ id: "call1", type: "function", function: { name: "lookup", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call1", content: [{ type: "text", text: "ok" }] },
    ];
    await call(f, { messages });
    expect(calls[0].body.input.messages[1]).toEqual({ role: "tool", tool_call_id: "call1", content: "ok" });
    await expect(call(f, { messages: [{ ...messages[1], content: [{ type: "input_audio" }] }] })).rejects.toThrow(/不支持/);
});
it("passes HTTP failures and rejects native business errors", async () => {
    const fail = fixture(() => new Response("rate limited", { status: 429 }));
    expect((await call(fail.f)).status).toBe(429);
    const native = fixture(() => Response.json({ code: "InvalidParameter", message: "bad" }));
    await expect(call(native.f)).rejects.toThrow(/InvalidParameter/);
});
it("authenticates native model metadata without changing root", async () => {
    const { f, calls } = fixture(() => Response.json({ data: [{ id: "test", context_length: 10 }] }));
    expect((await (await f(`${cfg.baseURL}models`, { method: "GET" })).json()).data[0].context_length).toBe(10);
    expect(calls[0].url).toBe(`${cfg.baseURL}models`);
    expect(calls[0].init.headers.get("authorization")).toBe("Bearer key");
});
for (const stream of [false, true]) {
    it(`ChatModel consumes native Qwen ${stream ? "SSE" : "JSON"}`, async () => {
        const { f } = fixture(() => (stream ? sse([terminal]) : Response.json(terminal)));
        const model = new ChatModel(
            stubCtx(),
            () => ({ model: "test", baseURL: cfg.baseURL }),
            { modelId: "test", abilities: [ModelAbility.Chat], parameters: { stream } },
            f,
            loggingStub(),
        );
        const result = await model.chat({ messages: [{ role: "user", content: "hi" }] });
        expect(result.text).toBe("你好");
        expect(result.usage?.total_tokens).toBe(6);
    });
    for (const reason of ["tool_calls", "length", "content_filter"])
        it(`ChatModel only executes complete Qwen tools (${stream}, ${reason})`, async () => {
            const tool = { id: "call1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } };
            const native = { output: { choices: [{ finish_reason: reason, message: { content: "", tool_calls: [tool] } }] }, usage: terminal.usage };
            const { f, calls } = fixture(() =>
                stream
                    ? sse([
                          {
                              output: {
                                  choices: [
                                      {
                                          finish_reason: "null",
                                          message: { content: "", tool_calls: [{ index: 0, ...tool, function: { name: "lookup", arguments: '{"q":' } }] },
                                      },
                                  ],
                              },
                          },
                          {
                              output: {
                                  choices: [{ finish_reason: reason, message: { content: "", tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] } }],
                              },
                              usage: terminal.usage,
                          },
                      ])
                    : Response.json(native),
            );
            let executions = 0;
            const model = new ChatModel(
                stubCtx(),
                () => ({ model: "test", baseURL: cfg.baseURL }),
                { modelId: "test", abilities: [ModelAbility.Chat], parameters: { stream } },
                f,
                loggingStub(),
            );
            const p = model.chat({
                singleStep: true,
                messages: [{ role: "user", content: "hi" }],
                tools: [
                    {
                        type: "function",
                        function: { name: "lookup", parameters: {} },
                        execute: () => {
                            executions++;
                            return {};
                        },
                    },
                ],
            });
            const error = await p.then(
                () => null,
                (error) => error,
            );
            expect(error === null).toBe(reason === "tool_calls");
            expect(executions).toBe(reason === "tool_calls" ? 1 : 0);
            expect(calls[0].init.headers.get("X-DashScope-SSE")).toBe(stream ? "enable" : null);
        });
}
it("rejects SSE truncation before executable deltas", async () => {
    const { f } = fixture(() => sse([{ output: { choices: [{ finish_reason: "null", message: { content: "partial" } }] } }]));
    await expect((await call(f, { stream: true })).text()).rejects.toThrow(/截断|结束/);
});
it("rejects unsupported generation controls", async () => {
    const { f, calls } = fixture(() => Response.json(terminal));
    await expect(call(f, { logit_bias: { "1": 1 } })).rejects.toThrow(/logit_bias/);
    expect(calls).toHaveLength(0);
});
for (const streaming of [false, true])
    it(`preserves Qwen thinking and native IDs across tool continuation (${streaming})`, async () => {
        const tool = { id: "native-id", type: "function", function: { name: "lookup", arguments: "{}" } };
        const native = {
            output: { choices: [{ finish_reason: "tool_calls", message: { content: "", reasoning_content: "private-native-thought", tool_calls: [tool] } }] },
        };
        const { f, calls } = fixture(() => (streaming && calls.length === 1 ? sse([native]) : Response.json(native)));
        const r = await call(f, { stream: streaming });
        const out = streaming
            ? (await r.text())
                  .split("\n")
                  .filter((x) => x.startsWith("data: {"))
                  .map((x) => JSON.parse(x.slice(6)))
                  .flatMap((x) => x.choices?.[0]?.delta?.tool_calls ?? [])[0]
            : (await r.json()).choices[0].message.tool_calls[0];
        await call(f, {
            preserve_thinking: true,
            messages: [
                { role: "assistant", content: "", tool_calls: [out] },
                { role: "tool", tool_call_id: out.id, content: "done" },
            ],
        });
        expect(calls[1].body.parameters.preserve_thinking).toBe(true);
        expect(calls[1].body.input.messages[0].reasoning_content).toBe("private-native-thought");
        expect(calls[1].body.input.messages[0].tool_calls[0].id).toBe("native-id");
        expect(calls[1].body.input.messages[1].tool_call_id).toBe("native-id");
    });
it("signals Qwen tool activity before EOF without exposing executable deltas", async () => {
    let close!: () => void;
    const encoder = new TextEncoder();
    const frame = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
    const { f } = fixture(
        () =>
            new Response(
                new ReadableStream({
                    start(c) {
                        c.enqueue(
                            frame({
                                output: {
                                    choices: [
                                        {
                                            finish_reason: "null",
                                            message: { tool_calls: [{ index: 0, id: "call1", function: { name: "lookup", arguments: "{}" } }] },
                                        },
                                    ],
                                },
                            }),
                        );
                        close = () => {
                            c.enqueue(frame({ output: { choices: [{ finish_reason: "tool_calls", message: { content: "" } }] } }));
                            c.close();
                        };
                    },
                }),
                { headers: { "content-type": "text/event-stream" } },
            ),
    );
    let notify!: () => void;
    const started = new Promise<boolean>((resolve) => {
        notify = () => resolve(true);
    });
    let executions = 0,
        count = 0;
    const model = new ChatModel(
        stubCtx(),
        () => ({ model: "test", baseURL: cfg.baseURL }),
        { modelId: "test", abilities: [ModelAbility.Chat], parameters: { stream: true } },
        f,
        loggingStub(),
    );
    const pending = model.chat({
        singleStep: true,
        onStreamStart: () => {
            count++;
            notify();
        },
        messages: [{ role: "user", content: "hi" }],
        tools: [
            {
                type: "function",
                function: { name: "lookup", parameters: {} },
                execute: () => {
                    executions++;
                    return {};
                },
            },
        ],
    });
    const observed = await Promise.race([started, new Promise((resolve) => setTimeout(() => resolve(false), 100))]);
    expect(executions).toBe(0);
    close();
    await pending;
    expect(observed).toBe(true);
    expect(count).toBe(1);
    expect(executions).toBe(1);
});
it("cancels Qwen native bodies and preserves abort signal", async () => {
    let cancelled = false;
    const { f, calls } = fixture(
        () =>
            new Response(
                new ReadableStream({
                    cancel() {
                        cancelled = true;
                    },
                }),
            ),
    );
    const signal = new AbortController().signal;
    const r = await f(`${cfg.baseURL}chat/completions`, { method: "POST", signal, body: JSON.stringify({ model: "test", messages: [], stream: true }) });
    await r.body!.cancel();
    expect(cancelled).toBe(true);
    expect(calls[0].init.signal).toBe(signal);
});
it("rejects Qwen in-band errors and sparse tool indices", async () => {
    const fail = fixture(() => sse([{ code: "QuotaExceeded", message: "busy" }]));
    await expect((await call(fail.f, { stream: true })).text()).rejects.toThrow(/QuotaExceeded/);
    const sparse = fixture(() =>
        sse([
            {
                output: {
                    choices: [
                        { finish_reason: "tool_calls", message: { tool_calls: [{ index: 1, id: "call2", function: { name: "lookup", arguments: "{}" } }] } },
                    ],
                },
            },
        ]),
    );
    await expect((await call(sparse.f, { stream: true })).text()).rejects.toThrow(/索引/);
});

it("keeps Qwen full-output and answer-only token caps distinct in native HTTP parameters", async () => {
    const { f, calls } = fixture(() => Response.json(terminal));
    await call(f, { max_completion_tokens: 100 });
    expect(calls[0].body.parameters.max_completion_tokens).toBe(100);
    expect(calls[0].body.parameters).not.toHaveProperty("max_tokens");
    await call(f, { max_completion_tokens: 100, max_tokens: 25 });
    expect(calls[1].body.parameters).toMatchObject({ max_completion_tokens: 100, max_tokens: 25 });
});
for (const streaming of [false, true])
    it(`preserves Qwen native cache and reasoning token details (${streaming})`, async () => {
        const nativeUsage = {
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120,
            cached_tokens: 1,
            prompt_tokens_details: { cached_tokens: 7, cache_creation_input_tokens: 11 },
            output_tokens_details: { reasoning_tokens: 13 },
        };
        const native = { ...terminal, usage: nativeUsage };
        const { f } = fixture(() => (streaming ? sse([native]) : Response.json(native)));
        const model = new ChatModel(
            stubCtx(),
            () => ({ model: "test", baseURL: cfg.baseURL }),
            { modelId: "test", abilities: [ModelAbility.Chat], parameters: { stream: streaming } },
            f,
            loggingStub(),
        );
        const result = await model.chat({ messages: [{ role: "user", content: "hi" }] });
        expect(result.usage).toMatchObject({
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_tokens_details: { cached_tokens: 7, cache_write_tokens: 11 },
            completion_tokens_details: { reasoning_tokens: 13 },
        });
    });
it("merges Qwen sparse streamed usage details without discarding earlier cache counts", async () => {
    const { f } = fixture(() =>
        sse([
            {
                output: { choices: [{ finish_reason: "null", message: { content: "你" } }] },
                usage: { input_tokens: 10, prompt_tokens_details: { cached_tokens: 3, cache_creation_input_tokens: 5 } },
            },
            {
                output: { choices: [{ finish_reason: "stop", message: { content: "好" } }] },
                usage: { output_tokens: 5, prompt_tokens_details: { cache_creation_input_tokens: 8 }, output_tokens_details: { reasoning_tokens: 2 } },
            },
        ]),
    );
    const frames = (await (await call(f, { stream: true })).text())
        .split("\n")
        .filter((line) => line.startsWith("data: {"))
        .map((line) => JSON.parse(line.slice(6)));
    expect(frames.find((frame) => frame.usage)?.usage).toMatchObject({
        prompt_tokens: 10,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 8 },
        completion_tokens_details: { reasoning_tokens: 2 },
    });
});
it("leaves unreported Qwen cache/reasoning counts absent and accepts legacy flat cached count", async () => {
    const { f } = fixture(() => Response.json(terminal));
    const out = await (await call(f)).json();
    expect(out.usage).not.toHaveProperty("prompt_tokens_details");
    expect(out.usage).not.toHaveProperty("completion_tokens_details");
    const legacy = fixture(() => Response.json({ ...terminal, usage: { ...terminal.usage, cached_tokens: 0 } }));
    expect((await (await call(legacy.f)).json()).usage.prompt_tokens_details.cached_tokens).toBe(0);
});
for (const stream of [false, true]) {
    for (const selected of ["required", { type: "function", function: { name: "lookup" } }]) {
        for (const matching of [false, true]) {
            it(`enforces Qwen thinking tool choice locally (${stream}, ${typeof selected}, ${matching})`, async () => {
                const named = typeof selected === "object";
                const name = matching ? "lookup" : "other";
                const hasCall = matching || named;
                const native = {
                    output: {
                        choices: [
                            {
                                finish_reason: hasCall ? "tool_calls" : "stop",
                                message: {
                                    content: hasCall ? "" : "no call",
                                    ...(hasCall ? { tool_calls: [{ id: "call1", type: "function", function: { name, arguments: "{}" } }] } : {}),
                                },
                            },
                        ],
                    },
                };
                const { f, calls } = fixture(() => (stream ? sse([native]) : Response.json(native)));
                const model = new ChatModel(
                    stubCtx(),
                    () => ({ model: "test", baseURL: cfg.baseURL }),
                    { modelId: "test", abilities: [ModelAbility.Chat], parameters: { stream } },
                    f,
                    loggingStub(),
                );
                let executions = 0;
                const result = model.chat({
                    singleStep: true,
                    toolChoice: selected,
                    enable_thinking: true,
                    messages: [{ role: "user", content: "hi" }],
                    tools: ["lookup", "other"].map((name) => ({
                        type: "function",
                        function: { name, parameters: {} },
                        execute: () => {
                            executions++;
                            return {};
                        },
                    })),
                });
                const error = await result.then(
                    () => null,
                    (error) => error,
                );
                expect(error === null).toBe(matching);
                expect(executions).toBe(matching ? 1 : 0);
                expect(calls[0].body.parameters.tool_choice).not.toBe("required");
                expect(typeof calls[0].body.parameters.tool_choice).not.toBe("object");
                expect(calls[0].body.parameters.enable_thinking).toBe(true);
            });
        }
    }
}
it("removes Qwen tools for none and rejects unsolicited native calls", async () => {
    const native = {
        output: {
            choices: [
                {
                    finish_reason: "tool_calls",
                    message: { content: "", tool_calls: [{ id: "call1", type: "function", function: { name: "lookup", arguments: "{}" } }] },
                },
            ],
        },
    };
    const { f, calls } = fixture(() => Response.json(native));
    await expect(call(f, { tool_choice: "none", tools: [{ type: "function", function: { name: "lookup", parameters: {} } }] })).rejects.toThrow(/tool_choice/);
    expect(calls[0].body.parameters).not.toHaveProperty("tools");
});
it("preserves the first Qwen tool ID/name when official later incremental frames contain empty strings", async () => {
    const { f } = fixture(() =>
        sse([
            {
                output: {
                    choices: [
                        {
                            finish_reason: "null",
                            message: { tool_calls: [{ index: 0, id: "original-id", type: "function", function: { name: "lookup", arguments: '{"q":' } }] },
                        },
                    ],
                },
            },
            {
                output: {
                    choices: [
                        { finish_reason: "null", message: { tool_calls: [{ index: 0, id: "", type: "function", function: { name: "", arguments: '"x"}' } }] } },
                    ],
                },
            },
            { output: { choices: [{ finish_reason: "tool_calls", message: { content: "" } }] } },
        ]),
    );
    const frames = (await (await call(f, { stream: true })).text())
        .split("\n")
        .filter((line) => line.startsWith("data: {"))
        .map((line) => JSON.parse(line.slice(6)));
    expect(frames.flatMap((frame) => frame.choices?.[0]?.delta?.tool_calls ?? [])[0]).toMatchObject({
        id: "original-id",
        function: { name: "lookup", arguments: '{"q":"x"}' },
    });
});
it("rejects conflicting nonempty Qwen tool identities in incremental frames", async () => {
    const { f } = fixture(() =>
        sse([
            {
                output: {
                    choices: [{ finish_reason: "null", message: { tool_calls: [{ index: 0, id: "id", function: { name: "lookup", arguments: "{}" } }] } }],
                },
            },
            {
                output: {
                    choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ index: 0, id: "id", function: { name: "changed", arguments: "" } }] } }],
                },
            },
        ]),
    );
    await expect((await call(f, { stream: true })).text()).rejects.toThrow(/名称/);
});
