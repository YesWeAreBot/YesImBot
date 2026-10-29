import type { ProviderConfig } from "../config";
import { ModelAbility } from "../config";
import { choice, completed, type Json, nativeSSE, partsOf, rejectUnknown, safeToolArguments } from "./shared";

function decodeToolId(id: string): { id: string; reasoning?: string } {
    if (typeof id !== "string" || !id) throw new Error("Qwen 工具调用缺少 ID");
    if (!id.startsWith("yib-qwen:")) return { id };
    try {
        const value = JSON.parse(Buffer.from(id.slice(9), "base64url").toString("utf8"));
        if (typeof value.id !== "string" || !value.id || typeof value.reasoning !== "string") throw new Error();
        return value;
    } catch {
        throw new Error("Qwen 工具调用元数据无效");
    }
}
function encodeToolId(id: string, reasoning: string | undefined): string {
    return reasoning ? `yib-qwen:${Buffer.from(JSON.stringify({ id, reasoning }), "utf8").toString("base64url")}` : id;
}
function text(content: unknown): string {
    return partsOf(content)
        .map((part) => {
            if (part.type !== "text" || typeof part.text !== "string") throw new Error("Qwen 原生工具或文本模型不支持此图片/音频内容，请使用视觉模型");
            return part.text;
        })
        .join("");
}
function messages(input: Json[], visual: boolean): Json[] {
    return input.map((message) => {
        if (!["system", "developer", "user", "assistant", "tool"].includes(message.role)) throw new Error("Qwen 不支持此消息角色");
        const role = message.role === "developer" ? "system" : message.role;
        let content: unknown;
        if (!visual || role === "tool") content = text(message.content);
        else
            content = partsOf(message.content).map((part) => {
                if (part.type === "text" && typeof part.text === "string") return { text: part.text };
                if (
                    role === "user" &&
                    part.type === "image_url" &&
                    typeof part.image_url?.url === "string" &&
                    /^(https?:\/\/|data:image\/)/.test(part.image_url.url)
                )
                    return { image: part.image_url.url };
                throw new Error(`Qwen 原生视觉接入不支持内容 ${part.type}`);
            });
        const result: Json = { role, content };
        if (role === "tool") {
            if (typeof message.tool_call_id !== "string" || !message.tool_call_id) throw new Error("Qwen 工具结果缺少调用 ID");
            result.tool_call_id = decodeToolId(message.tool_call_id).id;
        }
        if (message.tool_calls?.length)
            result.tool_calls = message.tool_calls.map((call: Json) => {
                if (!call.id || call.type !== "function" || !call.function?.name) throw new Error("Qwen 工具调用格式无效");
                safeToolArguments(call.function.arguments);
                const metadata = decodeToolId(call.id);
                if (metadata.reasoning !== undefined) result.reasoning_content = metadata.reasoning;
                return { id: metadata.id, type: "function", function: { name: call.function.name, arguments: call.function.arguments } };
            });
        if (typeof message.reasoning_content === "string") result.reasoning_content = message.reasoning_content;
        return result;
    });
}
function request(body: Json, visual: boolean): Json {
    const parametersAllowed = [
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
        "enable_thinking",
        "thinking_budget",
        "reasoning_effort",
        "enable_search",
        "search_options",
        "parallel_tool_calls",
        "repetition_penalty",
        "presence_penalty",
        "frequency_penalty",
        "tool_stream",
    ];
    rejectUnknown(body, ["model", "messages", "stream", "stream_options", "max_completion_tokens", "n", "preserve_thinking", ...parametersAllowed]);
    if (body.n !== undefined && body.n !== 1) throw new Error("Qwen 原生接入仅支持 n=1");
    const parameters: Json = { result_format: "message", incremental_output: true };
    if (body.preserve_thinking !== undefined) parameters.preserve_thinking = body.preserve_thinking;
    for (const key of parametersAllowed) if (body[key] !== undefined) parameters[key] = body[key];
    const selected = body.tool_choice;
    if (
        selected !== undefined &&
        !["auto", "none", "required"].includes(selected) &&
        !(selected?.type === "function" && typeof selected.function?.name === "string" && selected.function.name)
    )
        throw new Error("Qwen 不支持此 tool_choice");
    if (selected !== undefined) parameters.tool_choice = selected === "none" ? "none" : "auto";
    if (selected === "none") delete parameters.tools;
    if (body.tools?.length && selected !== "none")
        parameters.tools = body.tools.map((tool: Json) => {
            if (tool.type !== "function" || !tool.function?.name || tool.function.strict) throw new Error("Qwen 原生接入仅支持非 strict 函数工具");
            return {
                type: "function",
                function: { name: tool.function.name, description: tool.function.description ?? "", parameters: tool.function.parameters ?? {} },
            };
        });
    if (selected?.type === "function") {
        parameters.tools = parameters.tools?.filter((tool: Json) => tool.function.name === selected.function.name);
        if (!parameters.tools?.length) throw new Error("Qwen tool_choice 指定的工具未定义");
    }
    return { model: body.model, input: { messages: messages(body.messages ?? [], visual) }, parameters };
}
function checkError(value: Json) {
    if (value.code || (value.status_code !== undefined && Number(value.status_code) !== 200))
        throw new Error(`Qwen 原生接口错误 ${value.code ?? value.status_code}: ${value.message ?? "未知错误"}`);
}
function numeric(...values: unknown[]): number | undefined {
    return values.find((value) => typeof value === "number" && Number.isFinite(value) && value >= 0) as number | undefined;
}
function usage(value: Json = {}): Json {
    const cached = numeric(value.prompt_tokens_details?.cached_tokens, value.cached_tokens);
    const written = numeric(value.prompt_tokens_details?.cache_creation_input_tokens, value.cache_creation_input_tokens);
    const reasoning = numeric(value.output_tokens_details?.reasoning_tokens);
    return {
        prompt_tokens: numeric(value.input_tokens),
        completion_tokens: numeric(value.output_tokens),
        total_tokens: numeric(value.total_tokens),
        ...(cached !== undefined || written !== undefined
            ? {
                  prompt_tokens_details: {
                      ...(cached !== undefined ? { cached_tokens: cached } : {}),
                      ...(written !== undefined ? { cache_write_tokens: written } : {}),
                  },
              }
            : {}),
        ...(reasoning !== undefined ? { completion_tokens_details: { reasoning_tokens: reasoning } } : {}),
    };
}
function validateChoice(selected: unknown, calls: Json[]) {
    if (selected === "none" && calls.length) throw new Error("Qwen tool_choice none 不允许工具调用");
    if (selected === "required" && !calls.length) throw new Error("Qwen tool_choice required 未返回工具调用");
    if (selected && typeof selected === "object") {
        const name = (selected as Json).function.name;
        if (!calls.length || calls.some((call) => call.function.name !== name)) throw new Error("Qwen tool_choice 未返回指定的工具调用");
    }
}
function toolCalls(values: Json[], reasoning?: string): Json[] {
    return values.map((call) => {
        if (
            typeof call.id !== "string" ||
            !call.id ||
            typeof call.function?.name !== "string" ||
            !call.function.name ||
            typeof call.function.arguments !== "string"
        )
            throw new Error("Qwen 工具回复缺少完整 ID、名称或参数");
        safeToolArguments(call.function.arguments);
        return { id: encodeToolId(call.id, reasoning), type: "function", function: { name: call.function.name, arguments: call.function.arguments } };
    });
}
function finishReason(reason: unknown, calls: Json[]): string {
    if (calls.length && reason !== "tool_calls") throw new Error(`Qwen 工具回复未正常完成，禁止执行: ${String(reason)}`);
    if (!["stop", "length", "tool_calls", "content_filter"].includes(String(reason))) throw new Error(`Qwen 原生回复缺少正常结束原因: ${String(reason)}`);
    if (reason === "tool_calls" && !calls.length) throw new Error("Qwen 工具回复未包含完整工具调用");
    return String(reason);
}
function content(value: unknown): string {
    if (typeof value === "string") return value;
    if (value == null) return "";
    if (!Array.isArray(value) || value.some((part) => typeof part?.text !== "string")) throw new Error("Qwen 原生回复包含不支持的非文本内容");
    return value.map((part) => part.text).join("");
}
function json(value: unknown, response: Response): Response {
    const headers = new Headers({ "content-type": "application/json" });
    for (const key of ["request-id", "x-request-id"]) if (response.headers.has(key)) headers.set(key, response.headers.get(key)!);
    return new Response(JSON.stringify(value), { status: response.status, statusText: response.statusText, headers });
}
function stream(response: Response, selected: unknown): Response {
    let reason: unknown;
    let lastUsage: Json = {};
    let reasoning = "";
    const calls = new Map<number, Json>();
    return nativeSSE(
        response,
        (value) => {
            checkError(value);
            if (value.usage)
                lastUsage = {
                    ...lastUsage,
                    ...value.usage,
                    prompt_tokens_details: { ...lastUsage.prompt_tokens_details, ...value.usage.prompt_tokens_details },
                    output_tokens_details: { ...lastUsage.output_tokens_details, ...value.usage.output_tokens_details },
                };
            const candidate = value.output?.choices?.[0];
            if (!candidate) return [];
            const message = candidate.message ?? {};
            const text = content(message.content);
            if (reason !== undefined && (text || message.tool_calls?.length)) throw new Error("Qwen 结束标识之后仍有额外数据");
            const out: Json[] = [];
            if (text) out.push(choice({ content: text }));
            if (message.reasoning_content) {
                reasoning += message.reasoning_content;
                out.push(choice({ reasoning_content: message.reasoning_content }));
            }
            for (const call of message.tool_calls ?? []) {
                out.push(choice({ yib_native_activity: true }));
                const index = call.index ?? 0;
                if (!Number.isSafeInteger(index) || index < 0) throw new Error("Qwen 工具调用索引无效");
                const previous = calls.get(index);
                if (previous?.id && call.id && previous.id !== call.id) throw new Error("Qwen 工具调用 ID 在流中变化");
                const name = call.function?.name ?? "";
                const args = call.function?.arguments ?? "";
                if (typeof name !== "string" || typeof args !== "string") throw new Error("Qwen 流工具参数增量无效");
                if (previous?.function.name && name && previous.function.name !== name) throw new Error("Qwen 工具调用名称在流中变化");
                calls.set(index, {
                    id: call.id || previous?.id,
                    type: "function",
                    function: {
                        name: name || previous?.function.name || "",
                        arguments: (previous?.function.arguments ?? "") + args,
                    },
                });
            }
            if (candidate.finish_reason !== null && candidate.finish_reason !== undefined && candidate.finish_reason !== "null")
                reason = candidate.finish_reason;
            return out;
        },
        () => {
            const indexed = [...calls.entries()].sort(([a], [b]) => a - b);
            if (indexed.some(([index], expected) => index !== expected)) throw new Error("Qwen 工具调用索引不完整");
            const ordered = indexed.map(([, call]) => call);
            const normalized = toolCalls(ordered, reasoning);
            const terminal = finishReason(reason, normalized);
            validateChoice(selected, normalized);
            return [...normalized.map((call, index) => choice({ tool_calls: [{ index, ...call }] })), { ...choice({}, terminal), usage: usage(lastUsage) }];
        },
    );
}

/** DashScope native generation/embedding routes, selected from declared model capabilities. */
export function createQwenFetch(config: ProviderConfig, transport: typeof globalThis.fetch): typeof globalThis.fetch {
    const base = new URL(config.baseURL || "https://dashscope.aliyuncs.com/api/v1/");
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("Qwen API 根地址无效");
    base.pathname = base.pathname.replace(/\/?$/, "/");
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        const path = url.origin === base.origin && url.pathname.startsWith(base.pathname) ? url.pathname.slice(base.pathname.length) : "";
        const headers = new Headers(init?.headers);
        headers.set("authorization", `Bearer ${config.apiKey}`);
        headers.set("content-type", "application/json");
        headers.delete("X-DashScope-SSE");
        if ((init?.method ?? "GET") === "GET" && path === "models") return transport(input, { ...init, headers, redirect: "error" });
        if (typeof init?.body !== "string") throw new Error("Qwen 原生接入需要 JSON 请求体");
        const body = JSON.parse(init.body);
        if (typeof body.model !== "string" || !body.model) throw new Error("Qwen 原生接入缺少模型 ID");
        const endpoint = new URL(base);
        let payload: Json;
        if (path === "chat/completions") {
            const visual = config.models?.find((model) => model.modelId === body.model)?.abilities.includes(ModelAbility.Vision) ?? false;
            endpoint.pathname += `services/aigc/${visual ? "multimodal-generation" : "text-generation"}/generation`;
            payload = request(body, visual);
            if (body.stream) headers.set("X-DashScope-SSE", "enable");
        } else if (path === "embeddings") {
            rejectUnknown(body, ["model", "input", "dimensions", "encoding_format", "text_type", "instruct"]);
            if (body.encoding_format && body.encoding_format !== "float") throw new Error("Qwen 嵌入仅支持 float 格式");
            const inputs = Array.isArray(body.input) ? body.input : [body.input];
            if (!inputs.length || inputs.some((item: unknown) => typeof item !== "string")) throw new Error("Qwen 嵌入需要文本输入");
            endpoint.pathname += "services/embeddings/text-embedding/text-embedding";
            payload = {
                model: body.model,
                input: { texts: inputs },
                parameters: {
                    ...(body.dimensions !== undefined ? { dimension: body.dimensions } : {}),
                    ...(body.text_type !== undefined ? { text_type: body.text_type } : {}),
                    ...(body.instruct !== undefined ? { instruct: body.instruct } : {}),
                },
            };
        } else throw new Error("Qwen 原生接入不支持此 API 路径");
        const response = await transport(endpoint, { ...init, method: "POST", headers, redirect: "error", body: JSON.stringify(payload) });
        if (!response.ok) return response;
        if (path === "chat/completions" && body.stream) return stream(response, body.tool_choice);
        const value = await response.json();
        checkError(value);
        if (path === "embeddings") {
            const vectors = value.output?.embeddings;
            if (!Array.isArray(vectors) || vectors.length !== payload.input.texts.length) throw new Error("Qwen 嵌入响应不完整");
            const ordered = [...vectors].sort((a, b) => a.text_index - b.text_index);
            if (
                ordered.some(
                    (item, index) =>
                        item.text_index !== index ||
                        !Array.isArray(item.embedding) ||
                        !item.embedding.length ||
                        item.embedding.some((n: unknown) => typeof n !== "number" || !Number.isFinite(n)),
                )
            )
                throw new Error("Qwen 嵌入向量或索引无效");
            return json(
                {
                    data: ordered.map((item) => ({ index: item.text_index, object: "embedding", embedding: item.embedding })),
                    ...(value.usage?.total_tokens !== undefined
                        ? { usage: { prompt_tokens: value.usage.total_tokens, total_tokens: value.usage.total_tokens } }
                        : {}),
                },
                response,
            );
        }
        const candidate = value.output?.choices?.[0];
        if (!candidate?.message) throw new Error("Qwen 未返回有效回复");
        const calls = toolCalls(candidate.message.tool_calls ?? [], candidate.message.reasoning_content);
        validateChoice(body.tool_choice, calls);
        return json(
            completed(
                {
                    content: content(candidate.message.content),
                    ...(candidate.message.reasoning_content ? { reasoning_content: candidate.message.reasoning_content } : {}),
                    ...(calls.length ? { tool_calls: calls } : {}),
                },
                finishReason(candidate.finish_reason, calls),
                usage(value.usage),
                value.request_id,
            ),
            response,
        );
    }) as typeof globalThis.fetch;
}
