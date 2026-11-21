import type { EngineBaseConfig, SearchHit } from "./types.js";

export function truncate(text: string, maxChars: number): string {
    if (maxChars <= 0) return "";
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars - 1)}…`;
}

export function oneLine(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

export function requireText(value: unknown, label: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${label} is missing from the backend response`);
    }
    return value;
}

const defaultPorts: Record<string, string> = {
    "http:": "80",
    "https:": "443",
};

export function normalizeUrl(input: string): string {
    const url = new URL(input.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`Unsupported URL scheme: ${url.protocol}`);
    }
    if (url.username || url.password) throw new Error("URL must not contain credentials");
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (defaultPorts[url.protocol] === url.port) url.port = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
}

export function normalizeUrls(inputs: string[], max: number): string[] {
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const input of inputs) {
        const url = normalizeUrl(input);
        if (seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
    }
    if (urls.length > max) throw new Error(`At most ${max} URLs can be fetched per call`);
    return urls;
}

export function compileBlacklist(patterns: string[]): RegExp | undefined {
    if (patterns.length === 0) return undefined;
    return new RegExp(patterns.map((pattern) => `(?:${pattern})`).join("|"));
}

export function isBlocked(url: string, blocked: RegExp | undefined): boolean {
    if (!blocked) return false;
    blocked.lastIndex = 0;
    return blocked.test(url);
}

export function mergeHits(hits: SearchHit[]): SearchHit[] {
    const merged = new Map<string, SearchHit>();
    for (const hit of hits) {
        let url: string;
        try {
            url = normalizeUrl(hit.url);
        } catch {
            continue;
        }
        const existing = merged.get(url);
        if (!existing) {
            merged.set(url, {
                title: hit.title.trim() || url,
                url,
                snippet: hit.snippet.trim(),
                publishedAt: hit.publishedAt,
            });
            continue;
        }
        if (existing.snippet.length === 0) existing.snippet = hit.snippet.trim();
        if (!existing.publishedAt) existing.publishedAt = hit.publishedAt;
        if (!existing.title || existing.title === url) existing.title = hit.title.trim() || existing.title;
    }
    return [...merged.values()];
}

export function capAnswers(answers: string[], maxChars: number): string[] {
    const seen = new Set<string>();
    const capped: string[] = [];
    let remaining = maxChars;
    for (const answer of answers) {
        const text = answer.trim();
        if (text.length === 0 || seen.has(text) || remaining <= 0) continue;
        seen.add(text);
        capped.push(truncate(text, remaining));
        remaining -= capped.at(-1)!.length;
    }
    return capped;
}

export class SearchHttpError extends Error {
    constructor(public readonly status: number) {
        super(`HTTP ${status}`);
    }
}

export function describeEngineFailure(error: unknown): { message: string; retryable: boolean } {
    const value = error as { status?: number; statusCode?: number; name?: string; cause?: { code?: string } } | undefined;
    const status = value?.status ?? value?.statusCode;
    if (Number.isInteger(status) && status! >= 400 && status! < 600) {
        return { message: `HTTP ${status}`, retryable: status === 408 || status === 429 || status! >= 500 };
    }
    if (value?.name === "TimeoutError") return { message: "请求超时", retryable: true };
    if (value?.cause?.code?.startsWith("UND_ERR_") || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"].includes(value?.cause?.code ?? "")) {
        return { message: "网络请求失败", retryable: true };
    }
    return { message: "引擎未返回可用结果", retryable: false };
}

export interface JsonRequest {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs: number;
    signal?: AbortSignal;
}

export function joinUrl(endpoint: string, path: string): string {
    return `${endpoint.replace(/\/+$/, "")}${path}`;
}

export function queryString(values: Record<string, string | number | boolean | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined || value === "") continue;
        params.set(key, String(value));
    }
    const query = params.toString();
    return query.length > 0 ? `?${query}` : "";
}

export function engineTimeout(engine: EngineBaseConfig, fallback: number): number {
    return engine.timeoutMs > 0 ? engine.timeoutMs : fallback;
}

export function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function requestJson<T>(url: string, request: JsonRequest): Promise<T> {
    const headers: Record<string, string> = { ...request.headers };
    if (request.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(url, {
        method: request.method ?? "GET",
        headers,
        redirect: "error",
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: timeoutSignal(request.signal, request.timeoutMs),
    });
    if (!response.ok) {
        await response.body?.cancel();
        throw new SearchHttpError(response.status);
    }
    return (await response.json()) as T;
}
