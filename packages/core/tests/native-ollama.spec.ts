import { expect, it } from "vitest";

import { ChatModel } from "../src/model/chat-model";
import { ModelAbility } from "../src/model/config";
import { createOllamaFetch } from "../src/model/native/ollama";
import { loggingStub, stubCtx } from "./helpers/yesimbot";
const cfg = { type: "Ollama", name: "local", baseURL: "http://local.test/prefix/", apiKey: "key", models: [] } as any;
const terminal = { message: { role: "assistant", content: "你好" }, done: true, done_reason: "stop", prompt_eval_count: 4, eval_count: 2 };
function fixture(reply: () => Response) {
    const calls: any[] = [];
    const f = createOllamaFetch(cfg, (async (url: any, init: any) => {
        calls.push({ url: String(url), init, body: init?.body && JSON.parse(init.body) });
        return reply();
    }) as any);
    return { f, calls };
}
const call = (f: typeof fetch, extra: any = {}) =>
    f(`${cfg.baseURL}chat/completions`, { method: "POST", body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "hi" }], ...extra }) });
function ndjson(events: any[], split = false) {
    const bytes = new TextEncoder().encode(events.map((x) => JSON.stringify(x)).join("\n") + "\n");
    let i = 0;
    return new Response(
        new ReadableStream({
            pull(c) {
                if (i === bytes.length) return c.close();
                const n = split ? 1 : bytes.length;
                c.enqueue(bytes.slice(i, (i += n)));
            },
        }),
        { headers: { "content-type": "application/x-ndjson" } },
    );
}
it("uses native Ollama chat with options and token counts", async () => {
    const { f, calls } = fixture(() => Response.json(terminal));
    const out = await (await call(f, { temperature: 0.8, top_p: 0.9, max_tokens: 20 })).json();
    expect(calls[0].url).toBe("http://local.test/prefix/api/chat");
    expect(calls[0].body.options).toEqual({ temperature: 0.8, top_p: 0.9, num_predict: 20 });
    expect(out.usage).toMatchObject({ prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 });
});
it("translates tool arguments/results and base64 images", async () => {
    const { f, calls } = fixture(() => Response.json(terminal));
    await call(f, {
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: "look" },
                    { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
                ],
            },
            { role: "assistant", content: "", tool_calls: [{ id: "call1", type: "function", function: { name: "lookup", arguments: '{"q":"x"}' } }] },
            { role: "tool", tool_call_id: "call1", content: [{ type: "text", text: "result" }] },
        ],
    });
    expect(calls[0].body.messages[0]).toEqual({ role: "user", content: "look", images: ["aGVsbG8="] });
    expect(calls[0].body.messages[1].tool_calls[0].function.arguments).toEqual({ q: "x" });
    expect(calls[0].body.messages[2]).toEqual({ role: "tool", tool_name: "lookup", content: "result" });
});
it("uses native embeddings and tags without inventing context metadata", async () => {
    const { f, calls } = fixture(() => Response.json({ embeddings: [[1], [2]], prompt_eval_count: 5, models: [{ name: "test", model: "test" }] }));
    const r = await f(`${cfg.baseURL}embeddings`, { method: "POST", body: JSON.stringify({ model: "embed", input: ["a", "b"] }) });
    expect((await r.json()).data.map((x: any) => x.embedding)).toEqual([[1], [2]]);
    expect(calls[0].url).toBe("http://local.test/prefix/api/embed");
    expect(calls[0].body.truncate).toBe(false);
    const meta = await (await f(`${cfg.baseURL}models`, { method: "GET" })).json();
    expect(calls[1].url).toBe("http://local.test/prefix/api/tags");
    expect(meta.data[0]).toEqual({ name: "test", model: "test", id: "test" });
});
it("rejects unsupported controls, remote images and media tool results", async () => {
    const { f, calls } = fixture(() => Response.json(terminal));
    await expect(call(f, { tool_choice: "invalid" })).rejects.toThrow(/tool_choice/);
    await expect(call(f, { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://image.test/x.png" } }] }] })).rejects.toThrow(
        /base64/,
    );
    await expect(call(f, { messages: [{ role: "tool", tool_call_id: "x", content: [{ type: "input_audio" }] }] })).rejects.toThrow(/不支持|缺少/);
    expect(calls).toHaveLength(0);
});
it("preserves failures and abort signal; rejects invalid embeddings", async () => {
    const { f, calls } = fixture(() => new Response("busy", { status: 503 }));
    const signal = new AbortController().signal;
    const r = await f(`${cfg.baseURL}chat/completions`, { method: "POST", signal, body: JSON.stringify({ model: "test", messages: [] }) });
    expect(r.status).toBe(503);
    expect(calls[0].init.signal).toBe(signal);
    const bad = fixture(() => Response.json({ embeddings: [[1]] }));
    await expect(bad.f(`${cfg.baseURL}embeddings`, { method: "POST", body: JSON.stringify({ model: "test", input: ["a", "b"] }) })).rejects.toThrow(/嵌入/);
});
for (const stream of [false, true]) {
    it(`ChatModel consumes Ollama ${stream ? "NDJSON" : "JSON"} text`, async () => {
        const { f } = fixture(() =>
            stream
                ? ndjson(
                      [
                          { message: { content: "你" }, done: false },
                          { ...terminal, message: { content: "好" } },
                      ],
                      true,
                  )
                : Response.json(terminal),
        );
        const model = new ChatModel(
            stubCtx(),
            () => ({ model: "test", baseURL: cfg.baseURL }),
            { modelId: "test", abilities: [ModelAbility.Chat], parameters: { stream } },
            f,
            loggingStub(),
        );
        expect((await model.chat({ messages: [{ role: "user", content: "hi" }] })).text).toBe("你好");
    });
    for (const reason of ["stop", "length"])
        it(`ChatModel only executes complete Ollama tools (${stream}, ${reason})`, async () => {
            const native = {
                ...terminal,
                done_reason: reason,
                message: { content: "", tool_calls: [{ function: { name: "lookup", arguments: { q: "x" } } }] },
            };
            const { f } = fixture(() =>
                stream
                    ? ndjson([
                          { message: native.message, done: false },
                          { ...native, message: { content: "" } },
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
            expect(error === null).toBe(reason === "stop");
            expect(executions).toBe(reason === "stop" ? 1 : 0);
        });
}
it("rejects incomplete NDJSON before tool execution", async () => {
    const { f } = fixture(() => ndjson([{ message: { tool_calls: [{ function: { name: "lookup", arguments: {} } }] }, done: false }]));
    const r = await call(f, { stream: true });
    await expect(r.text()).rejects.toThrow(/结束|截断/);
});
it("cancels the native source when downstream cancels", async () => {
    let cancelled = false;
    const { f } = fixture(
        () =>
            new Response(
                new ReadableStream({
                    cancel() {
                        cancelled = true;
                    },
                }),
            ),
    );
    const r = await call(f, { stream: true });
    await r.body!.cancel();
    expect(cancelled).toBe(true);
});
for (const stream of [false, true]) {
    for (const selected of ["required", { type: "function", function: { name: "lookup" } }]) {
        for (const matching of [false, true])
            it(`enforces Ollama tool choice locally without sending unsupported fields (${stream}, ${typeof selected}, ${matching})`, async () => {
                const native = { ...terminal, message: { content: "", tool_calls: matching ? [{ function: { name: "lookup", arguments: {} } }] : [] } };
                const { f, calls } = fixture(() => (stream ? ndjson([native]) : Response.json(native)));
                const p = call(f, { stream, tool_choice: selected, tools: [{ type: "function", function: { name: "lookup", parameters: {} } }] }).then(
                    async (r) => {
                        if (stream) await r.text();
                        else await r.json();
                    },
                );
                const error = await p.then(
                    () => null,
                    (error) => error,
                );
                expect(error === null).toBe(matching);
                expect(calls[0].body).not.toHaveProperty("tool_choice");
                expect(calls[0].body.tools).toHaveLength(1);
            });
    }
}
it("signals real native tool activity before EOF and withholds execution", async () => {
    let close!: () => void;
    const bytes = new TextEncoder();
    const { f } = fixture(
        () =>
            new Response(
                new ReadableStream({
                    start(c) {
                        c.enqueue(
                            bytes.encode(JSON.stringify({ message: { tool_calls: [{ function: { name: "lookup", arguments: {} } }] }, done: false }) + "\n"),
                        );
                        close = () => {
                            c.enqueue(bytes.encode(JSON.stringify({ done: true, done_reason: "stop" }) + "\n"));
                            c.close();
                        };
                    },
                }),
                { headers: { "content-type": "application/x-ndjson" } },
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
it("preserves NDJSON business errors", async () => {
    const { f } = fixture(() => ndjson([{ error: "model unavailable" }]));
    await expect((await call(f, { stream: true })).text()).rejects.toThrow(/model unavailable/);
});
it("rejects missing argument objects and sparse native tool indices", async () => {
    for (const tool of [{ function: { name: "lookup" } }, { function: { index: 1, name: "lookup", arguments: {} } }]) {
        const { f } = fixture(() =>
            ndjson([
                { message: { tool_calls: [tool] }, done: false },
                { done: true, done_reason: "stop" },
            ]),
        );
        await expect((await call(f, { stream: true })).text()).rejects.toThrow(/参数|索引/);
    }
});
for (const streaming of [false, true])
    it(`ChatModel replays native Ollama thinking and native tool ID on the next tool turn (${streaming})`, async () => {
        const nativeTool = {
            ...terminal,
            message: { content: "", thinking: "private native thinking", tool_calls: [{ id: "vendor-call", function: { name: "lookup", arguments: {} } }] },
        };
        const { f, calls } = fixture(() =>
            streaming ? ndjson([calls.length === 1 ? nativeTool : terminal]) : Response.json(calls.length === 1 ? nativeTool : terminal),
        );
        const model = new ChatModel(
            stubCtx(),
            () => ({ model: "test", baseURL: cfg.baseURL }),
            { modelId: "test", abilities: [ModelAbility.Chat], parameters: { stream: streaming } },
            f,
            loggingStub(),
        );
        const result = await model.chat({
            maxSteps: 2,
            messages: [{ role: "user", content: "hi" }],
            tools: [{ type: "function", function: { name: "lookup", parameters: {} }, execute: () => ({ ok: true }) }],
        });
        expect(result.text).toBe("你好");
        expect(calls).toHaveLength(2);
        expect(calls[1].body.messages[1]).toMatchObject({
            role: "assistant",
            thinking: "private native thinking",
            tool_calls: [{ id: "vendor-call", function: { name: "lookup", arguments: {} } }],
        });
        expect(calls[1].body.messages[2]).toEqual({ role: "tool", tool_name: "lookup", content: '{"ok":true}' });
        expect(result.text).not.toContain("private native thinking");
    });
it("normalizes Ollama scalar stop and validates native stop arrays", async () => {
    const { f, calls } = fixture(() => Response.json(terminal));
    await call(f, { stop: "END" });
    expect(calls[0].body.options.stop).toEqual(["END"]);
    await call(f, { stop: ["END", "STOP"] });
    expect(calls[1].body.options.stop).toEqual(["END", "STOP"]);
    await expect(call(f, { stop: ["END", 3] })).rejects.toThrow(/stop/);
    await expect(call(f, { stop: { invalid: true } })).rejects.toThrow(/stop/);
    expect(calls).toHaveLength(2);
});
