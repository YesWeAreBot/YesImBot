import { randomUUID } from "node:crypto";

import type { ProviderConfig } from "../config";
import { choice, completed, inlineImage, type Json, nativeSSE, partsOf, rejectUnknown, safeToolArguments } from "./shared";

function decodeToolId(id: string): { id?: string; thinking?: string } {
    if (typeof id !== "string" || !id) throw new Error("Ollama 工具调用缺少 ID");
    if (!id.startsWith("yib-ollama:")) return { id };
    try {
        const value = JSON.parse(Buffer.from(id.slice(11), "base64url").toString("utf8"));
        if ((value.id !== undefined && typeof value.id !== "string") || (value.thinking !== undefined && typeof value.thinking !== "string")) throw new Error();
        return value;
    } catch {
        throw new Error("Ollama 工具调用元数据无效");
    }
}
function encodeToolId(nativeId: string | undefined, thinking: string | undefined): string {
    return `yib-ollama:${Buffer.from(JSON.stringify({ id: nativeId, nonce: nativeId ? undefined : randomUUID(), thinking }), "utf8").toString("base64url")}`;
}
function text(content: unknown): string {
    return partsOf(content)
        .map((part) => {
            if (part.type !== "text" || typeof part.text !== "string") throw new Error("Ollama 工具结果仅支持文本，不支持媒体");
            return part.text;
        })
        .join("");
}
function messages(input: Json[]): Json[] {
    const names = new Map<string, string>();
    return input.map((message) => {
        if (message.role === "tool") {
            const name = names.get(message.tool_call_id);
            if (!name) throw new Error("Ollama 工具结果缺少对应调用");
            return { role: "tool", tool_name: name, content: text(message.content) };
        }
        if (!["user", "assistant", "system", "developer"].includes(message.role)) throw new Error("Ollama 不支持此消息角色");
        const images: string[] = [];
        const content = partsOf(message.content)
            .map((part) => {
                if (part.type === "text" && typeof part.text === "string") return part.text;
                if (part.type === "image_url" && message.role === "user") {
                    const image = inlineImage(part.image_url?.url ?? "");
                    if (!image) throw new Error("Ollama 原生图片需要 base64 data URL");
                    images.push(image.data);
                    return "";
                }
                throw new Error(`Ollama 原生接入不支持消息内容 ${part.type}`);
            })
            .join("");
        let thinking = typeof message.thinking === "string" ? message.thinking : undefined;
        const toolCalls = message.tool_calls?.map((call: Json) => {
            if (call.type !== "function" || typeof call.id !== "string" || typeof call.function?.name !== "string") throw new Error("Ollama 工具调用格式无效");
            names.set(call.id, call.function.name);
            const metadata = decodeToolId(call.id);
            if (metadata.thinking !== undefined) thinking = metadata.thinking;
            return {
                ...(metadata.id !== undefined ? { id: metadata.id } : {}),
                type: "function",
                function: { name: call.function.name, arguments: safeToolArguments(call.function.arguments) },
            };
        });
        return {
            role: message.role === "developer" ? "system" : message.role,
            content,
            ...(images.length ? { images } : {}),
            ...(thinking !== undefined ? { thinking } : {}),
            ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
        };
    });
}
function request(body: Json): Json {
    rejectUnknown(body, [
        "model",
        "messages",
        "stream",
        "stream_options",
        "temperature",
        "top_p",
        "top_k",
        "seed",
        "max_tokens",
        "max_completion_tokens",
        "stop",
        "tools",
        "tool_choice",
        "response_format",
        "options",
        "think",
        "keep_alive",
        "n",
    ]);
    if (body.n !== undefined && body.n !== 1) throw new Error("Ollama 原生接入仅支持 n=1");
    if (
        body.tool_choice !== undefined &&
        !["auto", "none", "required"].includes(body.tool_choice) &&
        !(body.tool_choice?.type === "function" && typeof body.tool_choice.function?.name === "string")
    )
        throw new Error("Ollama 原生接口不支持此 tool_choice");
    const options: Json = { ...body.options };
    for (const key of ["temperature", "top_p", "top_k", "seed"]) if (body[key] !== undefined) options[key] = body[key];
    const stop = body.stop ?? options.stop;
    if (stop !== undefined) {
        if (typeof stop === "string") options.stop = [stop];
        else if (Array.isArray(stop) && stop.every((item) => typeof item === "string")) options.stop = stop;
        else throw new Error("Ollama stop 必须为字符串或字符串数组");
    }
    if (body.max_completion_tokens !== undefined || body.max_tokens !== undefined) options.num_predict = body.max_completion_tokens ?? body.max_tokens;
    const result: Json = { model: body.model, messages: messages(body.messages ?? []), stream: !!body.stream, options };
    for (const key of ["think", "keep_alive"]) if (body[key] !== undefined) result[key] = body[key];
    if (body.tools?.length && body.tool_choice !== "none")
        result.tools = body.tools.map((tool: Json) => {
            if (tool.type !== "function" || !tool.function?.name || tool.function.strict) throw new Error("Ollama 原生接口仅支持非 strict 函数工具");
            return {
                type: "function",
                function: { name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters ?? {} },
            };
        });
    if (body.response_format?.type === "json_object") result.format = "json";
    else if (body.response_format?.type === "json_schema") result.format = body.response_format.json_schema?.schema;
    else if (body.response_format && body.response_format.type !== "text") throw new Error("Ollama 不支持此 response_format");
    return result;
}
function usage(value: Json): Json {
    const input = value.prompt_eval_count,
        output = value.eval_count;
    return {
        prompt_tokens: input,
        completion_tokens: output,
        ...(input !== undefined && output !== undefined ? { total_tokens: input + output } : {}),
        ...(value.prompt_eval_cached_count !== undefined ? { prompt_tokens_details: { cached_tokens: value.prompt_eval_cached_count } } : {}),
    };
}
function tools(values: Json[], thinking?: string): Json[] {
    return values.map((call) => {
        if (typeof call.function?.name !== "string" || !call.function.name) throw new Error("Ollama 工具回复缺少名称");
        const args = call.function.arguments;
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Ollama 工具参数必须为对象");
        return { id: encodeToolId(call.id, thinking), type: "function", function: { name: call.function.name, arguments: JSON.stringify(args) } };
    });
}
function validateChoice(selected: unknown, calls: Json[]) {
    if (selected === "none" && calls.length) throw new Error("Ollama tool_choice none 不允许工具调用");
    if (selected === "required" && !calls.length) throw new Error("Ollama tool_choice required 未返回工具调用");
    if (selected && typeof selected === "object") {
        const name = (selected as Json).function.name;
        if (!calls.length || calls.some((call) => call.function.name !== name)) throw new Error("Ollama tool_choice 未返回指定的工具调用");
    }
}
function validateTerminal(value: Json, calls: Json[]): string {
    if (value.done !== true) throw new Error("Ollama 回复已截断，缺少 done 结束标识");
    if (calls.length && value.done_reason !== "stop") throw new Error(`Ollama 工具回复未正常完成，禁止执行: ${value.done_reason}`);
    if (value.done_reason && !["stop", "length"].includes(value.done_reason)) throw new Error(`Ollama 原生回复异常结束: ${value.done_reason}`);
    return calls.length ? "tool_calls" : value.done_reason === "length" ? "length" : "stop";
}
function json(value: unknown, response: Response): Response {
    const headers = new Headers({ "content-type": "application/json" });
    for (const key of ["request-id", "x-request-id"]) if (response.headers.has(key)) headers.set(key, response.headers.get(key)!);
    return new Response(JSON.stringify(value), { status: response.status, statusText: response.statusText, headers });
}
function stream(response: Response, selected: unknown): Response {
    if (!response.body) throw new Error("Ollama 返回空响应体");
    const decoder = new TextDecoder(),
        encoder = new TextEncoder();
    let buffer = "";
    const encodeRecord = (line: string) => {
        const value = JSON.parse(line);
        if (typeof value.error === "string") value.error = { message: value.error };
        return encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
    };
    const source = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                buffer += decoder.decode(chunk, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop()!;
                for (const line of lines) if (line.trim()) controller.enqueue(encodeRecord(line));
            },
            flush(controller) {
                buffer += decoder.decode();
                if (buffer.trim()) controller.enqueue(encodeRecord(buffer));
            },
        }),
    );
    let terminal: Json | undefined;
    let thinking = "";
    const calls = new Map<number, Json>();
    return nativeSSE(
        new Response(source, { status: response.status, headers: response.headers }),
        (value) => {
            if (terminal) throw new Error("Ollama 结束标识之后仍有额外数据");
            const out: Json[] = [];
            if (value.message?.content) out.push(choice({ content: value.message.content }));
            if (value.message?.thinking) {
                thinking += value.message.thinking;
                out.push(choice({ reasoning_content: value.message.thinking }));
            }
            for (const call of value.message?.tool_calls ?? []) {
                out.push(choice({ yib_native_activity: true }));
                const index = call.function?.index ?? call.index ?? calls.size;
                if (!Number.isSafeInteger(index) || index < 0) throw new Error("Ollama 工具调用索引无效");
                const previous = calls.get(index);
                const incoming = call.function?.arguments;
                if (incoming !== undefined && (!incoming || typeof incoming !== "object" || Array.isArray(incoming)))
                    throw new Error("Ollama 流工具参数必须为对象");
                const args = incoming === undefined ? previous?.function?.arguments : { ...previous?.function?.arguments, ...incoming };
                calls.set(index, { ...previous, ...call, function: { ...previous?.function, ...call.function, arguments: args } });
            }
            if (value.done === true) terminal = value;
            return out;
        },
        () => {
            const ordered = [...calls.entries()].sort(([a], [b]) => a - b);
            if (ordered.some(([index], expected) => index !== expected)) throw new Error("Ollama 工具调用索引不完整");
            const toolCalls = tools(
                ordered.map(([, call]) => call),
                thinking,
            );
            const reason = validateTerminal(terminal ?? {}, toolCalls);
            validateChoice(selected, toolCalls);
            return [...toolCalls.map((call, index) => choice({ tool_calls: [{ index, ...call }] })), { ...choice({}, reason), usage: usage(terminal!) }];
        },
    );
}

/** Native Ollama /api endpoints; the caller's existing fetch handles proxy and cancellation. */
export function createOllamaFetch(config: ProviderConfig, transport: typeof globalThis.fetch): typeof globalThis.fetch {
    const base = new URL(config.baseURL || "http://localhost:11434/");
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("Ollama API 根地址无效");
    base.pathname = base.pathname.replace(/\/?$/, "/");
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const inputURL = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        const path = inputURL.origin === base.origin && inputURL.pathname.startsWith(base.pathname) ? inputURL.pathname.slice(base.pathname.length) : "";
        const headers = new Headers(init?.headers);
        headers.set("content-type", "application/json");
        if (config.apiKey) headers.set("authorization", `Bearer ${config.apiKey}`);
        else headers.delete("authorization");
        const endpoint = new URL(base);
        if ((init?.method ?? "GET") === "GET" && path === "models") {
            endpoint.pathname += "api/tags";
            const response = await transport(endpoint, { ...init, headers, redirect: "error" });
            if (!response.ok) return response;
            const value = await response.json();
            if (!Array.isArray(value.models)) throw new Error("Ollama 模型列表响应无效");
            return json({ data: value.models.map((model: Json) => ({ ...model, id: model.model ?? model.name })) }, response);
        }
        if (typeof init?.body !== "string") throw new Error("Ollama 原生接入需要 JSON 请求体");
        const body = JSON.parse(init.body);
        if (typeof body.model !== "string" || !body.model) throw new Error("Ollama 原生接入缺少模型 ID");
        let payload: Json;
        if (path === "chat/completions") {
            endpoint.pathname += "api/chat";
            payload = request(body);
        } else if (path === "embeddings") {
            rejectUnknown(body, ["model", "input", "dimensions", "encoding_format", "truncate", "keep_alive", "options"]);
            if (body.encoding_format && body.encoding_format !== "float") throw new Error("Ollama 嵌入仅支持 float 格式");
            const inputs = Array.isArray(body.input) ? body.input : [body.input];
            if (!inputs.length || inputs.some((item: unknown) => typeof item !== "string")) throw new Error("Ollama 嵌入需要文本输入");
            endpoint.pathname += "api/embed";
            payload = {
                model: body.model,
                input: body.input,
                truncate: body.truncate ?? false,
                ...(body.dimensions !== undefined ? { dimensions: body.dimensions } : {}),
                ...(body.keep_alive !== undefined ? { keep_alive: body.keep_alive } : {}),
                ...(body.options !== undefined ? { options: body.options } : {}),
            };
        } else throw new Error("Ollama 原生接入不支持此 API 路径");
        const response = await transport(endpoint, { ...init, method: "POST", headers, redirect: "error", body: JSON.stringify(payload) });
        if (!response.ok) return response;
        if (path === "chat/completions" && body.stream) return stream(response, body.tool_choice);
        const value = await response.json();
        if (value.error) throw new Error(`Ollama 原生接口错误: ${value.error}`);
        if (path === "embeddings") {
            const count = Array.isArray(body.input) ? body.input.length : 1;
            if (
                !Array.isArray(value.embeddings) ||
                value.embeddings.length !== count ||
                value.embeddings.some((v: unknown) => !Array.isArray(v) || !v.length || v.some((n) => typeof n !== "number" || !Number.isFinite(n)))
            )
                throw new Error("Ollama 嵌入响应不完整");
            return json(
                {
                    data: value.embeddings.map((embedding: number[], index: number) => ({ index, object: "embedding", embedding })),
                    ...(value.prompt_eval_count !== undefined
                        ? { usage: { prompt_tokens: value.prompt_eval_count, total_tokens: value.prompt_eval_count } }
                        : {}),
                },
                response,
            );
        }
        const toolCalls = tools(value.message?.tool_calls ?? [], value.message?.thinking);
        const reason = validateTerminal(value, toolCalls);
        validateChoice(body.tool_choice, toolCalls);
        return json(
            completed({ content: value.message?.content ?? "", ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, reason, usage(value)),
            response,
        );
    }) as typeof globalThis.fetch;
}
