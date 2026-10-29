import { getProviderBaseURL, getProviderProtocol, type ProviderConfig } from "./config";
import { anthropicRequest, anthropicResponse, anthropicStream } from "./native/anthropic";
import { geminiEmbeddings, geminiRequest, geminiResponse, geminiStream } from "./native/gemini";
import { createLMStudioFetch } from "./native/lmstudio";
import { createOllamaFetch } from "./native/ollama";
import { createQwenFetch } from "./native/qwen";
import { Json, nativeSSE } from "./native/shared";
import { createWorkersFetch } from "./native/workers";

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
    const protocol = getProviderProtocol(config.type);
    if (!protocol || protocol === "chat-completions") return transport;
    const base = new URL(getProviderBaseURL(config));
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("原生 API 地址必须为不含凭据的 HTTP(S) URL");
    if (protocol === "ollama-native") return createOllamaFetch(config, transport);
    if (protocol === "qwen-native") return createQwenFetch(config, transport);
    if (protocol === "workers-native") return createWorkersFetch({ ...config, baseURL: base.href }, transport);
    if (protocol === "lmstudio-native") return createLMStudioFetch(config, transport);
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
