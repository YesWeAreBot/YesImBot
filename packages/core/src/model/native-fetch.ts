import type { ProviderConfig } from "./config";
import { anthropicRequest, anthropicResponse, anthropicStream } from "./native/anthropic";
import { geminiEmbeddings, geminiRequest, geminiResponse, geminiStream } from "./native/gemini";
import { Json, nativeSSE } from "./native/shared";

function normalizedJson(value: unknown, response: Response): Response {
    const headers = new Headers({ "content-type": "application/json" });
    for (const key of ["request-id", "x-request-id", "x-goog-request-id"]) {
        const value = response.headers.get(key);
        if (value) headers.set(key, value);
    }
    return new Response(JSON.stringify(value), { status: response.status, statusText: response.statusText, headers });
}

/** Protocol translation is inside the existing proxy/abort and usage observation paths. */
export function createNativeFetch(config: ProviderConfig, transport: typeof globalThis.fetch): typeof globalThis.fetch {
    const protocol = config.protocol;
    if (!protocol || protocol === "openai-compatible") return transport;
    if ((protocol === "gemini-native" && config.type !== "Google Gemini") || (protocol === "anthropic-native" && config.type !== "Anthropic"))
        throw new Error("原生接入协议与提供商类型不匹配");
    if (protocol !== "gemini-native" && protocol !== "anthropic-native") throw new Error("未知提供商接入协议");
    const base = new URL(
        config.baseURL || (protocol === "gemini-native" ? "https://generativelanguage.googleapis.com/v1beta/" : "https://api.anthropic.com/v1/"),
    );
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("原生 API 地址必须为不含凭据的 HTTP(S) URL");
    if (/\/openai\/?$/.test(base.pathname)) throw new Error("原生 API 地址不能使用 /openai 兼容端点，请填写原生版本根地址");
    base.pathname = base.pathname.replace(/\/?$/, "/");
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        const relative = url.origin === base.origin && url.pathname.startsWith(base.pathname) ? url.pathname.slice(base.pathname.length) : "";
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        headers.delete("authorization");
        if (protocol === "gemini-native") headers.set("x-goog-api-key", config.apiKey);
        else {
            headers.set("x-api-key", config.apiKey);
            if (!headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
        }
        if ((init?.method ?? "GET") === "GET" && relative === "models") return transport(input, { ...init, headers, redirect: "error" });
        if (relative !== "chat/completions" && relative !== "embeddings") throw new Error("原生接入不支持此 API 路径");
        if (typeof init?.body !== "string") throw new Error("原生接入需要 JSON 请求体");
        const body: Json = JSON.parse(init.body);
        if (typeof body.model !== "string" || !body.model) throw new Error("原生接入缺少模型 ID");
        const model = body.model.replace(/^models\//, "");
        const endpoint = new URL(base);
        headers.set("content-type", "application/json");
        let payload: Json;
        if (relative === "embeddings") {
            if (protocol !== "gemini-native") throw new Error("Anthropic 原生接入不支持嵌入");
            endpoint.pathname += `models/${encodeURIComponent(model)}:batchEmbedContents`;
            payload = geminiEmbeddings(body);
        } else if (protocol === "gemini-native") {
            endpoint.pathname += `models/${encodeURIComponent(model)}:${body.stream ? "streamGenerateContent" : "generateContent"}`;
            if (body.stream) endpoint.searchParams.set("alt", "sse");
            payload = geminiRequest(body);
        } else {
            endpoint.pathname += "messages";
            payload = anthropicRequest(body);
        }
        const response = await transport(endpoint, { ...init, method: "POST", headers, redirect: "error", body: JSON.stringify(payload) });
        if (!response.ok) return response;
        if (relative === "embeddings") {
            const value = await response.json();
            if (
                !Array.isArray(value.embeddings) ||
                value.embeddings.length !== payload.requests.length ||
                value.embeddings.some(
                    (item: Json) =>
                        !Array.isArray(item.values) ||
                        !item.values.length ||
                        item.values.some((value: unknown) => typeof value !== "number" || !Number.isFinite(value)),
                )
            )
                throw new Error("Gemini 嵌入响应不完整");
            return normalizedJson(
                { data: value.embeddings.map((item: Json, index: number) => ({ index, object: "embedding", embedding: item.values })) },
                response,
            );
        }
        if (body.stream) {
            const adapter = protocol === "gemini-native" ? geminiStream() : anthropicStream();
            return nativeSSE(response, adapter.consume, adapter.finish);
        }
        const value = await response.json();
        return normalizedJson(protocol === "gemini-native" ? geminiResponse(value) : anthropicResponse(value), response);
    }) as typeof globalThis.fetch;
}
