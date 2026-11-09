import { describe, expect, it } from "vitest";

import { ChatModel } from "../src/model/chat-model";
import { ModelAbility } from "../src/model/config";
import { createWorkersFetch } from "../src/model/native/workers";
import { loggingStub, stubCtx } from "./helpers/yesimbot";
const root = "https://example.test/accounts/acct/ai/";
const config = { type: "Workers AI", apiKey: "secret", accountId: "acct", baseURL: root } as any;
const call = (f: typeof fetch, body: any = {}, path = "chat/completions") =>
    f(root + path, { method: "POST", body: JSON.stringify({ model: "@cf/vendor/model", messages: [{ role: "user", content: "hi" }], ...body }) });
function setup(response: () => Response) {
    const calls: any[] = [];
    return {
        calls,
        fetch: createWorkersFetch(config, (async (url, init) => {
            calls.push({ url: String(url), init, body: init?.body && JSON.parse(String(init.body)) });
            return response();
        }) as typeof fetch),
    };
}
const sse = (values: any[], done = true) =>
    new Response(values.map((v) => `data: ${JSON.stringify(v)}\n\n`).join("") + (done ? "data: [DONE]\n\n" : ""), {
        headers: { "content-type": "text/event-stream" },
    });
describe("Workers AI native", () => {
    it("uses model run route and native functions", async () => {
        const t = setup(() => Response.json({ success: true, result: { response: "", tool_calls: [{ name: "lookup", arguments: { q: "x" } }] } }));
        const r = await (await call(t.fetch, { tools: [{ type: "function", function: { name: "lookup", parameters: {} } }] })).json();
        expect(t.calls[0].url).toBe(root + "run/@cf/vendor/model");
        expect(t.calls[0].body.tools).toEqual([{ name: "lookup", parameters: {} }]);
        expect(t.calls[0].body.model).toBeUndefined();
        expect(r.choices[0].message.tool_calls[0].function).toEqual({ name: "lookup", arguments: '{"q":"x"}' });
    });
    it("maps native embeddings and rejects missing vectors", async () => {
        const t = setup(() =>
            Response.json({
                success: true,
                result: {
                    shape: [2, 2],
                    data: [
                        [1, 2],
                        [3, 4],
                    ],
                },
            }),
        );
        const out = await (await call(t.fetch, { input: ["one", "two"], messages: undefined }, "embeddings")).json();
        expect(t.calls[0].body).toEqual({ text: ["one", "two"] });
        expect(out.data[1].embedding).toEqual([3, 4]);
        const bad = setup(() => Response.json({ result: { data: [[1, 2]] }, success: true }));
        await expect(call(bad.fetch, { input: ["one", "two"], messages: undefined }, "embeddings")).rejects.toThrow(/./);
    });
    for (const stream of [false, true])
        it(`works through ChatModel (${stream})`, async () => {
            const t = setup(() =>
                stream
                    ? sse([{ response: "你好" }, { response: null, usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }])
                    : Response.json({ result: { response: "你好", usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }, success: true }),
            );
            const model = new ChatModel(
                stubCtx(),
                () => ({ model: "@cf/vendor/model", baseURL: root, apiKey: "secret" }),
                { modelId: "@cf/vendor/model", abilities: [ModelAbility.Chat], parameters: { stream } },
                t.fetch,
                loggingStub(),
            );
            const out = await model.chat({ messages: [{ role: "user", content: "hi" }] });
            expect(out.text).toBe("你好");
            expect(out.usage?.total_tokens).toBe(5);
        });
    for (const tail of ["", 'data: {"error":{"message":"failed"}}\n\n', "data: broken\n\n"])
        it(`withholds tools for failed/truncated stream ${tail}`, async () => {
            const t = setup(() => new Response('data: {"tool_calls":[{"name":"lookup","arguments":{}}]}\n\n' + tail));
            const response = await call(t.fetch, { stream: true });
            const reader = response.body!.getReader();
            let text = "";
            await expect(
                (async () => {
                    while (true) {
                        const v = await reader.read();
                        if (v.done) break;
                        text += new TextDecoder().decode(v.value);
                    }
                })(),
            ).rejects.toThrow(/./);
            expect(text).not.toContain('"tool_calls"');
            expect(text).toContain("yib_native_activity");
        });
    it("preserves auth signal and HTTP errors", async () => {
        const signal = new AbortController().signal;
        const t = setup(() => new Response("quota", { status: 429 }));
        const r = await t.fetch(root + "chat/completions", { method: "POST", signal, body: JSON.stringify({ model: "@cf/a/b", messages: [] }) });
        expect(r.status).toBe(429);
        expect(t.calls[0].init.signal).toBe(signal);
        expect(t.calls[0].init.headers.get("authorization")).toBe("Bearer secret");
    });
    it("rejects API envelope failure and malformed native tools", async () => {
        await expect(call(setup(() => Response.json({ success: false, errors: [{ message: "denied" }] })).fetch)).rejects.toThrow(/denied/);
        await expect(
            call(setup(() => Response.json({ success: true, result: { tool_calls: [{ name: "lookup", arguments: "broken" }] } })).fetch),
        ).rejects.toThrow(/./);
    });
});

for (const stream of [false, true]) {
    it(`Workers ChatModel executes complete native tool only after valid completion (${stream})`, async () => {
        const native = { response: "", tool_calls: [{ name: "lookup", arguments: { q: "hello" } }] };
        const t = setup(() => (stream ? sse([native]) : Response.json({ success: true, result: native })));
        let calls = 0;
        const model = new ChatModel(
            stubCtx(),
            () => ({ model: "@cf/vendor/model", baseURL: root, apiKey: "secret" }),
            { modelId: "@cf/vendor/model", abilities: [ModelAbility.Chat], parameters: { stream } },
            t.fetch,
            loggingStub(),
        );
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
        expect(calls).toBe(1);
    });
}
it("Workers ChatModel never executes buffered tool on truncated stream", async () => {
    const t = setup(() => sse([{ tool_calls: [{ name: "lookup", arguments: {} }] }], false));
    let calls = 0;
    const model = new ChatModel(
        stubCtx(),
        () => ({ model: "@cf/vendor/model", baseURL: root, apiKey: "secret" }),
        { modelId: "@cf/vendor/model", abilities: [ModelAbility.Chat], parameters: { stream: true } },
        t.fetch,
        loggingStub(),
    );
    await expect(
        model.chat({
            singleStep: true,
            messages: [{ role: "user", content: "hello" }],
            tools: [
                {
                    type: "function",
                    function: { name: "lookup", parameters: {} },
                    execute: () => {
                        calls++;
                        return {};
                    },
                },
            ],
        }),
    ).rejects.toThrow(/网络请求失败|截断/);
    expect(calls).toBe(0);
});
it("Workers delivers early activity before terminal and releases tool only at clean EOF", async () => {
    let finish!: () => void;
    const t = setup(
        () =>
            new Response(
                new ReadableStream({
                    start(c) {
                        c.enqueue(new TextEncoder().encode('data: {"tool_calls":[{"name":"lookup","arguments":{}}]}\n\n'));
                        finish = () => {
                            c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                            c.close();
                        };
                    },
                }),
            ),
    );
    const response = await call(t.fetch, { stream: true });
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("yib_native_activity");
    expect(first).not.toContain('"tool_calls"');
    finish();
    let tail = "";
    while (true) {
        const next = await reader.read();
        if (next.done) break;
        tail += new TextDecoder().decode(next.value);
    }
    expect(tail).toContain('"tool_calls"');
});
it("Workers cancellation reaches native stream", async () => {
    let cancelled = false;
    const t = setup(
        () =>
            new Response(
                new ReadableStream({
                    cancel() {
                        cancelled = true;
                    },
                }),
            ),
    );
    const r = await call(t.fetch, { stream: true });
    await r.body!.cancel();
    await Promise.resolve();
    expect(cancelled).toBe(true);
});

it("Workers native bridge crosses a real local HTTP boundary with fragmented unicode SSE", async () => {
    const { createServer } = await import("node:http");
    const { once } = await import("node:events");
    let requestPath = "";
    let requestBody: any;
    const server = createServer(async (req, res) => {
        requestPath = req.url!;
        let text = "";
        for await (const chunk of req) text += chunk;
        requestBody = JSON.parse(text);
        res.writeHead(200, { "content-type": "text/event-stream" });
        const bytes = Buffer.from(
            requestBody.tools ? 'data: {"tool_calls":[{"name":"lookup","arguments":{}}]}\n\ndata: [DONE]\n\n' : 'data: {"response":"你好"}\n\ndata: [DONE]\n\n',
        );
        for (const byte of bytes) res.write(Buffer.from([byte]));
        res.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as { port: number };
    const localRoot = `http://127.0.0.1:${address.port}/accounts/acct/ai/`;
    try {
        const { request } = await import("node:http");
        const { Readable } = await import("node:stream");
        const localTransport = ((url: any, init: any) =>
            new Promise<Response>((resolve, reject) => {
                if (new URL(String(url)).hostname !== "127.0.0.1") return reject(new Error("Local test transport only"));
                const req = request(String(url), { method: init.method, headers: Object.fromEntries(init.headers), signal: init.signal }, (res) =>
                    resolve(new Response(Readable.toWeb(res) as ReadableStream, { status: res.statusCode })),
                );
                req.on("error", reject);
                req.end(init.body);
            })) as typeof fetch;
        const f = createWorkersFetch({ ...config, baseURL: localRoot }, localTransport);
        const response = await f(localRoot + "chat/completions", {
            method: "POST",
            body: JSON.stringify({ model: "@cf/vendor/model", messages: [{ role: "user", content: "hello" }], stream: true }),
        });
        expect(await response.text()).toContain("你好");
        expect(requestPath).toBe("/accounts/acct/ai/run/@cf/vendor/model");
        expect(requestBody).toEqual({ messages: [{ role: "user", content: "hello" }], stream: true });
        const requiredResponse = await f(localRoot + "chat/completions", {
            method: "POST",
            body: JSON.stringify({
                model: "@cf/vendor/model",
                messages: [{ role: "user", content: "hello" }],
                stream: true,
                tool_choice: "required",
                tools: [{ type: "function", function: { name: "lookup", parameters: {} } }],
            }),
        });
        expect(await requiredResponse.text()).toContain('"name":"lookup"');
        expect(requestBody).not.toHaveProperty("tool_choice");
        expect(requestBody.tools).toEqual([{ name: "lookup", parameters: {} }]);
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
});

it("Workers rejects an in-band JSON error even when HTTP status is successful", async () => {
    const t = setup(() => Response.json({ error: { message: "quota exceeded" }, response: "" }));
    await expect(call(t.fetch)).rejects.toThrow(/quota exceeded/);
});

for (const stream of [false, true]) {
    for (const selected of ["required", { type: "function", function: { name: "lookup" } }] as const) {
        for (const returned of ["lookup", "other", "none"]) {
            it(`Workers locally enforces ${JSON.stringify(selected)} before ChatModel tool execution (${stream}, ${returned})`, async () => {
                const native = {
                    response: returned === "none" ? "no tool" : "",
                    ...(returned === "none" ? {} : { tool_calls: [{ name: returned, arguments: {} }] }),
                };
                const t = setup(() => (stream ? sse([native]) : Response.json({ success: true, result: native })));
                let calls = 0;
                const model = new ChatModel(
                    stubCtx(),
                    () => ({ model: "@cf/vendor/model", baseURL: root, apiKey: "secret" }),
                    { modelId: "@cf/vendor/model", abilities: [ModelAbility.Chat], parameters: { stream } },
                    t.fetch,
                    loggingStub(),
                );
                const request = model.chat({
                    singleStep: true,
                    messages: [{ role: "user", content: "hello" }],
                    toolChoice: selected,
                    tools: ["lookup", "other"].map((name) => ({
                        type: "function" as const,
                        function: { name, parameters: {} },
                        execute: () => {
                            calls++;
                            return {};
                        },
                    })),
                });
                const rejected = returned === "none" || (typeof selected !== "string" && returned !== "lookup");
                const outcome = await request.then(
                    (value) => ({ toolCalls: value.toolCalls.length, error: "" }),
                    (error) => ({ toolCalls: 0, error: String(error) }),
                );
                expect(outcome.toolCalls).toBe(rejected ? 0 : 1);
                expect(outcome.error).toMatch(rejected ? /tool_choice|网络请求失败/ : /^$/);
                expect(calls).toBe(rejected ? 0 : 1);
                expect(t.calls).toHaveLength(1);
                expect(t.calls[0].body).not.toHaveProperty("tool_choice");
            });
        }
    }
    it(`Workers tool_choice none removes native tools and rejects unsolicited calls (${stream})`, async () => {
        const native = { response: "", tool_calls: [{ name: "lookup", arguments: {} }] };
        const t = setup(() => (stream ? sse([native]) : Response.json({ success: true, result: native })));
        const response = call(t.fetch, { stream, tool_choice: "none", tools: [{ type: "function", function: { name: "lookup", parameters: {} } }] });
        const error = await response
            .then((value) => value.text())
            .then(
                () => "",
                (error) => String(error),
            );
        expect(error).toMatch(/tool_choice/);
        expect(t.calls[0].body).not.toHaveProperty("tools");
        expect(t.calls[0].body).not.toHaveProperty("tool_choice");
    });
}
