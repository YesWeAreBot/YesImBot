import type { ProviderConfig } from "../config";
import { choice, completed, inlineImage, Json, nativeSSE, partsOf, rejectUnknown } from "./shared";

function nativeRequest(body: Json): Json {
    rejectUnknown(body, [
        "model",
        "messages",
        "stream",
        "stream_options",
        "temperature",
        "top_p",
        "top_k",
        "min_p",
        "repeat_penalty",
        "max_tokens",
        "max_completion_tokens",
        "tools",
        "tool_choice",
        "n",
        "reasoning",
    ]);
    if (body.tools?.length || (body.tool_choice !== undefined && body.tool_choice !== "none"))
        throw new Error("LM Studio 原生对话不支持客户端自定义函数工具，请禁用原生工具调用以使用 JSON 动作");
    if (body.n !== undefined && body.n !== 1) throw new Error("LM Studio 原生对话仅支持 n=1");
    if (!Array.isArray(body.messages)) throw new Error("LM Studio 原生接入需要 messages 数组");
    const system: string[] = [];
    const input: Json[] = [];
    let userTurns = 0;
    for (const message of body.messages) {
        if (message.tool_calls?.length || !["user", "system", "developer"].includes(message.role))
            throw new Error("LM Studio 原生对话无法回放 assistant/tool 历史，请使用有状态会话或 OpenAI Compatible 类型");
        if (message.role !== "user") {
            if (typeof message.content !== "string") throw new Error("LM Studio 原生系统提示必须为文本");
            system.push(message.content);
            continue;
        }
        userTurns++;
        for (const part of partsOf(message.content)) {
            if (part.type === "text" && typeof part.text === "string") input.push({ type: "text", content: part.text });
            else if (part.type === "image_url" && typeof part.image_url?.url === "string" && inlineImage(part.image_url.url))
                input.push({ type: "image", data_url: part.image_url.url });
            else throw new Error("LM Studio 原生 HTTP 对话仅支持文本与 base64 图片 data URL，不支持远程图片地址或文件上传");
        }
    }
    if (userTurns !== 1 || !input.length) throw new Error("LM Studio 原生对话需要且仅支持一条当前 user 输入");
    const result: Json = { model: body.model, input, ...(system.length ? { system_prompt: system.join("\n\n") } : {}), stream: !!body.stream, store: false };
    for (const key of ["temperature", "top_p", "top_k", "min_p", "repeat_penalty", "reasoning"]) if (body[key] !== undefined) result[key] = body[key];
    if (body.max_tokens !== undefined || body.max_completion_tokens !== undefined) result.max_output_tokens = body.max_completion_tokens ?? body.max_tokens;
    return result;
}
function resultOf(value: Json): Json {
    if (!Array.isArray(value.output)) throw new Error("LM Studio 原生接口未返回有效 output");
    for (const item of value.output)
        if (!item || !["message", "reasoning"].includes(item.type) || typeof item.content !== "string")
            throw new Error("LM Studio 返回了未启用的服务端工具或无效输出");
    const input = value.stats?.input_tokens;
    const output = value.stats?.total_output_tokens;
    return completed(
        {
            content: value.output
                .filter((item: Json) => item.type === "message")
                .map((item: Json) => item.content)
                .join(""),
        },
        "stop",
        {
            prompt_tokens: input,
            completion_tokens: output,
            total_tokens: input !== undefined && output !== undefined ? input + output : undefined,
            completion_tokens_details: { reasoning_tokens: value.stats?.reasoning_output_tokens },
        },
        value.response_id,
    );
}
/** Native v1 supports current-user inputs, not arbitrary stateless history or client function tools.
 * No integrations are enabled. Images must be data URLs. Embeddings deliberately use the sole
 * documented HTTP endpoint /v1/embeddings (OpenAI-compatible), not an invented native endpoint. */
export function createLMStudioFetch(config: ProviderConfig, transport: typeof globalThis.fetch): typeof globalThis.fetch {
    const base = new URL(config.baseURL || "http://localhost:1234/");
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("LM Studio 原生 API 地址必须是不含凭据的 HTTP(S) URL");
    base.pathname = base.pathname.replace(/\/?$/, "/");
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : undefined;
        const url = new URL(request ? request.url : String(input));
        if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error("LM Studio 请求超出已配置的 API 根地址");
        const path = url.pathname.slice(base.pathname.length);
        const headers = new Headers(init?.headers ?? request?.headers);
        if (config.apiKey) headers.set("authorization", `Bearer ${config.apiKey}`);
        const options = { ...init, headers, redirect: "error" as const, signal: init?.signal ?? request?.signal };
        if (path === "models" && (init?.method ?? request?.method ?? "GET") === "GET") {
            const response = await transport(new URL("api/v1/models", base), { ...options, method: "GET" });
            if (!response.ok) return response;
            const value = await response.json();
            if (!Array.isArray(value.models)) throw new Error("LM Studio 原生模型列表响应无效");
            return Response.json({ ...value, data: value.models.map((model: Json) => ({ ...model, id: model.key })) });
        }
        if (!["embeddings", "chat/completions"].includes(path) || typeof init?.body !== "string")
            throw new Error("LM Studio 原生接入不支持此 API 路径或请求体");
        const body: Json = JSON.parse(init.body);
        if (typeof body.model !== "string" || !body.model) throw new Error("LM Studio 原生接入缺少模型 ID");
        headers.set("content-type", "application/json");
        if (path === "embeddings") return transport(new URL("v1/embeddings", base), { ...options, method: "POST", body: init.body });
        const payload = nativeRequest(body);
        const response = await transport(new URL("api/v1/chat", base), { ...options, method: "POST", body: JSON.stringify(payload) });
        if (!response.ok) return response;
        if (!body.stream) return Response.json(resultOf(await response.json()));
        let end: Json | undefined;
        let started = false;
        return nativeSSE(
            response,
            (event) => {
                if (end) throw new Error("LM Studio 原生流在 chat.end 后仍有数据");
                if (event.type === "chat.start") {
                    started = true;
                    return [];
                }
                if (event.type?.startsWith("tool_call.")) throw new Error("LM Studio 原生流返回了未启用的服务端工具事件");
                if (event.type === "chat.end") {
                    if (!event.result) throw new Error("LM Studio 原生流缺少结束 result");
                    end = resultOf(event.result);
                    return [];
                }
                if (event.type === "message.delta") {
                    if (typeof event.content !== "string") throw new Error("LM Studio 原生流文本增量无效");
                    return [choice({ content: event.content })];
                }
                if (
                    [
                        "model_load.start",
                        "model_load.progress",
                        "model_load.end",
                        "prompt_processing.start",
                        "prompt_processing.progress",
                        "prompt_processing.end",
                        "reasoning.start",
                        "reasoning.delta",
                        "reasoning.end",
                        "message.start",
                        "message.end",
                    ].includes(event.type)
                )
                    return [];
                throw new Error(`LM Studio 不支持此原生流事件 ${event.type}`);
            },
            () => {
                if (!started || !end) throw new Error("LM Studio 原生流已截断");
                return [{ ...choice({}, "stop"), usage: end.usage }];
            },
        );
    }) as typeof globalThis.fetch;
}
