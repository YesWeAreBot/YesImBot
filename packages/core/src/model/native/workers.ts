import { randomUUID } from "node:crypto";

import type { ProviderConfig } from "../config";
import { choice, completed, Json, nativeSSE, rejectUnknown, safeToolArguments } from "./shared";

const convertTerminal = (line: string) => (/^data:\s*\[DONE\]\s*$/.test(line.trim()) ? 'data: {"yib_workers_done":true}' : line);

function unwrap(value: Json): Json {
    if (value.error) throw new Error(`Workers AI 原生接口错误: ${value.error.message ?? "未知错误"}`);
    if (value.success === false || value.errors?.length) throw new Error(`Workers AI: ${value.errors?.map((e: Json) => e.message).join("; ") || "请求失败"}`);
    return value.result ?? value;
}
function callsOf(value: unknown): Json[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error("Workers AI 返回的 tool_calls 格式无效");
    return value.map((call) => {
        if (!call || typeof call.name !== "string" || !call.name) throw new Error("Workers AI 原生工具名称无效");
        const args = typeof call.arguments === "string" ? safeToolArguments(call.arguments) : call.arguments;
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Workers AI 原生工具参数无效");
        return {
            id: typeof call.id === "string" && call.id ? call.id : randomUUID(),
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(args) },
        };
    });
}
function chatBody(body: Json): Json {
    rejectUnknown(body, [
        "model",
        "messages",
        "stream",
        "stream_options",
        "temperature",
        "top_p",
        "top_k",
        "max_tokens",
        "max_completion_tokens",
        "repetition_penalty",
        "frequency_penalty",
        "presence_penalty",
        "seed",
        "tools",
        "tool_choice",
        "n",
    ]);
    if (body.n !== undefined && body.n !== 1) throw new Error("Workers AI 原生接入仅支持 n=1");
    const selected = body.tool_choice;
    if (
        selected !== undefined &&
        !["auto", "none", "required"].includes(selected) &&
        !(selected?.type === "function" && typeof selected.function?.name === "string" && selected.function.name)
    )
        throw new Error("Workers AI 原生接入不支持此 tool_choice");
    if ((selected === "required" || selected?.type === "function") && !body.tools?.length) throw new Error("Workers AI tool_choice 需要提供函数工具");
    if (selected?.type === "function" && !body.tools?.some((tool: Json) => tool.function?.name === selected.function.name))
        throw new Error("Workers AI tool_choice 指定了未声明的工具");
    if (!Array.isArray(body.messages)) throw new Error("Workers AI 原生接入需要 messages 数组");
    const messages = body.messages.map((message: Json) => {
        if (!["system", "user", "assistant", "tool"].includes(message.role) || (message.content != null && typeof message.content !== "string"))
            throw new Error("Workers AI 原生对话适配器仅支持文本消息");
        if (message.tool_calls?.length || message.role === "tool")
            throw new Error("Workers AI 原生适配器不支持工具调用历史回放，请禁用原生工具调用以使用 JSON 动作");
        return { role: message.role, content: message.content ?? "" };
    });
    const result: Json = { messages, stream: !!body.stream };
    for (const key of ["temperature", "top_p", "top_k", "repetition_penalty", "frequency_penalty", "presence_penalty", "seed"])
        if (body[key] !== undefined) result[key] = body[key];
    if (body.max_completion_tokens !== undefined || body.max_tokens !== undefined) result.max_tokens = body.max_completion_tokens ?? body.max_tokens;
    if (body.tools?.length && selected !== "none")
        result.tools = body.tools.map((tool: Json) => {
            if (tool.type !== "function" || typeof tool.function?.name !== "string" || tool.function.strict)
                throw new Error("Workers AI 原生接入仅支持非 strict 的函数工具");
            return {
                name: tool.function.name,
                ...(tool.function.description !== undefined ? { description: tool.function.description } : {}),
                parameters: tool.function.parameters ?? {},
            };
        });
    return result;
}
function validateChoice(selected: unknown, calls: Json[]): void {
    if (selected === "none" && calls.length) throw new Error("Workers AI tool_choice none 不允许工具调用");
    if (selected === "required" && !calls.length) throw new Error("Workers AI tool_choice required 未返回工具调用");
    if (selected && typeof selected === "object" && "type" in selected && selected.type === "function") {
        const name = (selected as Json).function.name;
        if (!calls.length || calls.some((call) => call.function.name !== name)) throw new Error("Workers AI tool_choice 未返回指定的工具调用");
    }
}
/** Public /ai/run model schemas vary. This adapter supports response/tool_calls text models and dense embedding models. */
export function createWorkersFetch(config: ProviderConfig, transport: typeof globalThis.fetch): typeof globalThis.fetch {
    if (!config.accountId || !/^[a-zA-Z0-9_-]+$/.test(config.accountId)) throw new Error("Workers AI 需要有效的 accountId");
    const base = new URL(config.baseURL || `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/`);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("Workers AI 原生 API 地址必须是不含凭据的 HTTP(S) URL");
    base.pathname = base.pathname.replace(/\/?$/, "/");
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : undefined;
        const url = new URL(request ? request.url : String(input));
        if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error("Workers AI 请求超出已配置的 API 根地址");
        const path = url.pathname.slice(base.pathname.length);
        const headers = new Headers(init?.headers ?? request?.headers);
        headers.set("authorization", `Bearer ${config.apiKey}`);
        const options = { ...init, headers, redirect: "error" as const, signal: init?.signal ?? request?.signal };
        if ((init?.method ?? request?.method ?? "GET") === "GET" && path === "models") {
            const response = await transport(new URL("models/search", base), { ...options, method: "GET" });
            if (!response.ok) return response;
            const value = await response.json();
            const models = unwrap(value);
            if (!Array.isArray(models)) throw new Error("Workers AI 模型列表响应无效");
            return Response.json({ ...value, data: models.map((m: Json) => ({ ...m, id: m.name })) });
        }
        if (!["chat/completions", "embeddings"].includes(path) || typeof init?.body !== "string")
            throw new Error("Workers AI 原生接入不支持此 API 路径或请求体");
        const body: Json = JSON.parse(init.body);
        if (typeof body.model !== "string" || !/^@[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]+$/.test(body.model) || body.model.split("/").includes(".."))
            throw new Error("Workers AI 模型 ID 无效，必须采用 @cf/提供商/模型 等格式");
        const embed = path === "embeddings";
        let payload: Json;
        let count = 0;
        if (embed) {
            rejectUnknown(body, ["model", "input", "encoding_format", "pooling"]);
            if (body.encoding_format !== undefined && body.encoding_format !== "float") throw new Error("Workers AI 原生嵌入仅支持 float 编码");
            if (
                !(typeof body.input === "string" || (Array.isArray(body.input) && body.input.length && body.input.every((x: unknown) => typeof x === "string")))
            )
                throw new Error("Workers AI 原生嵌入需要文本或非空文本数组");
            count = Array.isArray(body.input) ? body.input.length : 1;
            payload = { text: body.input, ...(body.pooling !== undefined ? { pooling: body.pooling } : {}) };
        } else payload = chatBody(body);
        headers.set("content-type", "application/json");
        const endpoint = new URL(base);
        endpoint.pathname += `run/${body.model}`;
        const response = await transport(endpoint, { ...options, method: "POST", body: JSON.stringify(payload) });
        if (!response.ok) return response;
        if (embed) {
            const result = unwrap(await response.json());
            if (
                !Array.isArray(result.data) ||
                result.data.length !== count ||
                result.data.some((v: unknown) => !Array.isArray(v) || !v.length || v.some((n: unknown) => typeof n !== "number" || !Number.isFinite(n)))
            )
                throw new Error("Workers AI 原生嵌入响应不完整");
            return Response.json({
                data: result.data.map((embedding: number[], index: number) => ({ object: "embedding", embedding, index })),
                usage: result.usage,
            });
        }
        if (!body.stream) {
            const result = unwrap(await response.json());
            const calls = callsOf(result.tool_calls);
            validateChoice(body.tool_choice, calls);
            if (typeof result.response !== "string" && !calls.length) throw new Error("Workers AI 原生接口未返回有效回复");
            return Response.json(
                completed(
                    { content: result.response ?? "", ...(calls.length ? { tool_calls: calls } : {}) },
                    calls.length ? "tool_calls" : "stop",
                    result.usage ?? {},
                ),
            );
        }
        // shared nativeSSE ignores [DONE]. Convert that wire terminal into an explicit JSON event
        // so tool calls are released only after a terminal marker AND successful source EOF.
        if (!response.body) throw new Error("Workers AI 原生接口返回了空流响应体");
        const decoder = new TextDecoder();
        let buffer = "";
        const encode = new TextEncoder();
        const marked = response.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                    buffer += decoder.decode(chunk, { stream: true });
                    let end: number;
                    while ((end = buffer.indexOf("\n")) >= 0) {
                        controller.enqueue(encode.encode(convertTerminal(buffer.slice(0, end).replace(/\r$/, "")) + "\n"));
                        buffer = buffer.slice(end + 1);
                    }
                },
                flush(controller) {
                    buffer += decoder.decode();
                    if (buffer) controller.enqueue(encode.encode(convertTerminal(buffer)));
                },
            }),
        );
        let terminal = false;
        let sawOutput = false;
        let usage: Json = {};
        const calls: Json[] = [];
        return nativeSSE(
            new Response(marked, { status: response.status, headers: response.headers }),
            (value) => {
                if (terminal) throw new Error("Workers AI 流结束事件后仍有数据");
                if (value.yib_workers_done) {
                    terminal = true;
                    return [];
                }
                const result = unwrap(value);
                if (result.usage) usage = result.usage;
                const output: Json[] = [];
                if (result.response != null) {
                    if (typeof result.response !== "string") throw new Error("Workers AI 原生流文本增量无效");
                    sawOutput = true;
                    output.push(choice({ content: result.response }));
                }
                if (result.tool_calls?.length) {
                    sawOutput = true;
                    calls.push(...callsOf(result.tool_calls));
                    output.push(choice({ yib_native_activity: true }));
                }
                return output;
            },
            () => {
                if (!terminal || !sawOutput) throw new Error("Workers AI 原生流已截断或没有输出");
                validateChoice(body.tool_choice, calls);
                return [
                    ...calls.map((call, index) => choice({ tool_calls: [{ index, ...call }] })),
                    { ...choice({}, calls.length ? "tool_calls" : "stop"), usage },
                ];
            },
        );
    }) as typeof globalThis.fetch;
}
