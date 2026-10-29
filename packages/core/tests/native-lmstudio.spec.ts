import { describe, expect, it } from "vitest";

import { ChatModel } from "../src/model/chat-model";
import { ModelAbility } from "../src/model/config";
import { createLMStudioFetch } from "../src/model/native/lmstudio";
import { loggingStub, stubCtx } from "./helpers/yesimbot";
const root = "https://example.test/relay/";
const config = { type: "LM Studio", apiKey: "token", baseURL: root } as any;
const call = (f: typeof fetch, body: any = {}) =>
    f(root + "chat/completions", {
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
function setup(response: () => Response) {
    const calls: any[] = [];
    return {
        calls,
        fetch: createLMStudioFetch(config, (async (url, init) => {
            calls.push({ url: String(url), init, body: init?.body && JSON.parse(String(init.body)) });
            return response();
        }) as typeof fetch),
    };
}
const result = { output: [{ type: "message", content: "你好" }], stats: { input_tokens: 2, total_output_tokens: 3, reasoning_output_tokens: 1 } };
const sse = (values: any[]) => new Response(values.map((v) => `event: ${v.type}\ndata: ${JSON.stringify(v)}\n\n`).join(""));
describe("LM Studio native", () => {
    it("uses native chat without enabling server integrations", async () => {
        const t = setup(() => Response.json(result));
        const out = await (await call(t.fetch)).json();
        expect(t.calls[0].url).toBe(root + "api/v1/chat");
        expect(t.calls[0].body).toEqual({ model: "test", input: [{ type: "text", content: "hello" }], system_prompt: "rules", stream: false, store: false });
        expect(out.choices[0].message.content).toBe("你好");
        expect(out.usage.total_tokens).toBe(5);
    });
    for (const stream of [false, true])
        it(`works through ChatModel (${stream})`, async () => {
            const t = setup(() =>
                stream ? sse([{ type: "chat.start" }, { type: "message.delta", content: "你好" }, { type: "chat.end", result }]) : Response.json(result),
            );
            const m = new ChatModel(
                stubCtx(),
                () => ({ model: "test", baseURL: root, apiKey: "token" }),
                { modelId: "test", abilities: [ModelAbility.Chat], parameters: { stream } },
                t.fetch,
                loggingStub(),
            );
            const out = await m.chat({ messages: [{ role: "user", content: "hello" }] });
            expect(out.text).toBe("你好");
            expect(out.usage?.total_tokens).toBe(5);
        });
    it("rejects unsupported tools history remote images and integrations before sending", async () => {
        const t = setup(() => Response.json(result));
        for (const body of [
            { tools: [{ type: "function", function: { name: "lookup" } }] },
            {
                messages: [
                    { role: "assistant", content: "old" },
                    { role: "user", content: "new" },
                ],
            },
            { integrations: ["danger"] },
            { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/image.png" } }] }] },
        ])
            await expect(call(t.fetch, body)).rejects.toThrow(/./);
        expect(t.calls).toHaveLength(0);
    });
    it("maps data-url image input", async () => {
        const t = setup(() => Response.json(result));
        await call(t.fetch, { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,aGk=" } }] }] });
        expect(t.calls[0].body.input).toEqual([{ type: "image", data_url: "data:image/png;base64,aGk=" }]);
    });
    it("uses actual documented compatible embedding endpoint and native models", async () => {
        const t = setup(() => Response.json({ models: [{ key: "test", max_context_length: 4096 }] }));
        await t.fetch(root + "embeddings", { method: "POST", body: JSON.stringify({ model: "test", input: ["one"] }) });
        expect(t.calls[0].url).toBe(root + "v1/embeddings");
        const r = await (await t.fetch(root + "models")).json();
        expect(t.calls[1].url).toBe(root + "api/v1/models");
        expect(r.data[0].id).toBe("test");
    });
    for (const events of [
        [{ type: "message.delta", content: "partial" }],
        [
            { type: "chat.end", result },
            { type: "error", error: { message: "failed" } },
        ],
        [{ type: "chat.end", result: { output: [{ type: "tool_call", tool: "lookup", arguments: {} }], stats: {} } }],
    ])
        it("rejects incomplete failed and server-tool streams", async () => {
            const t = setup(() => sse(events));
            await expect((await call(t.fetch, { stream: true })).text()).rejects.toThrow(/./);
        });
    it("preserves failed HTTP response", async () => {
        const t = setup(() => new Response("bad", { status: 503 }));
        expect((await call(t.fetch)).status).toBe(503);
    });
});

it("LM Studio rejects server tool JSON without reporting executable calls", async () => {
    const t = setup(() => Response.json({ output: [{ type: "tool_call", tool: "lookup", arguments: {}, output: "already executed remotely" }], stats: {} }));
    await expect(call(t.fetch)).rejects.toThrow(/服务端工具/);
});
it("LM Studio preserves optional Bearer authentication and abort signal", async () => {
    const t = setup(() => Response.json(result));
    const signal = new AbortController().signal;
    await t.fetch(root + "chat/completions", { method: "POST", signal, body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "hi" }] }) });
    expect(t.calls[0].init.signal).toBe(signal);
    expect(t.calls[0].init.headers.get("authorization")).toBe("Bearer token");
});
it("LM Studio cancellation reaches native stream", async () => {
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
    expect(cancelled).toBe(true);
});

it("LM Studio bridge crosses real local HTTP with native request and response shapes", async () => {
    const { createServer } = await import("node:http");
    const { once } = await import("node:events");
    let path = "";
    let body: any;
    const server = createServer(async (req, res) => {
        path = req.url!;
        let text = "";
        for await (const chunk of req) text += chunk;
        body = JSON.parse(text);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as { port: number };
    const localRoot = `http://127.0.0.1:${address.port}/`;
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
        const f = createLMStudioFetch({ ...config, baseURL: localRoot }, localTransport);
        const response = await f(localRoot + "chat/completions", {
            method: "POST",
            body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "hello" }] }),
        });
        expect((await response.json()).choices[0].message.content).toBe("你好");
        expect(path).toBe("/api/v1/chat");
        expect(body).toEqual({ model: "test", input: [{ type: "text", content: "hello" }], stream: false, store: false });
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
});
