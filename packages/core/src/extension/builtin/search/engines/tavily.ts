import type { FetchedPage, SearchEngine, TavilyEngineConfig } from "../types.js";
import { engineTimeout, joinUrl, requestJson, requireText } from "../utils.js";

interface TavilySearchResponse {
    answer?: string;
    results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        published_date?: string;
    }>;
}

interface TavilyExtractResponse {
    results?: Array<{ url?: string; raw_content?: string }>;
    failed_results?: Array<{ url?: string; error?: string }>;
}

export function createTavilyEngine(config: TavilyEngineConfig, pluginTimeout: number): SearchEngine {
    const timeoutMs = engineTimeout(config, pluginTimeout);
    const label = `Tavily (${config.id})`;

    return {
        id: config.id,
        backend: config.backend,

        async search({ query, limit, signal }) {
            const data = await requestJson<TavilySearchResponse>(joinUrl(config.endpoint, "/search"), {
                method: "POST",
                headers: { authorization: `Bearer ${config.apiKey}` },
                body: {
                    query,
                    search_depth: config.searchDepth,
                    max_results: Math.min(limit, 20),
                    include_answer: config.includeAnswer,
                    include_raw_content: false,
                    include_favicon: false,
                },
                timeoutMs,
                signal,
            });
            const results = (data.results ?? []).flatMap((item) => {
                if (!item.url) return [];
                return [
                    {
                        title: item.title?.trim() || item.url,
                        url: item.url,
                        snippet: item.content ?? "",
                        publishedAt: item.published_date,
                    },
                ];
            });
            return {
                results,
                answers: data.answer?.trim() ? [data.answer] : undefined,
            };
        },

        async fetchPage(url, signal): Promise<FetchedPage> {
            const data = await requestJson<TavilyExtractResponse>(joinUrl(config.endpoint, "/extract"), {
                method: "POST",
                headers: { authorization: `Bearer ${config.apiKey}` },
                body: { urls: [url] },
                timeoutMs,
                signal,
            });
            const failed = data.failed_results?.find((item) => item.url === url);
            if (failed) throw new Error(`${label} extract failed: ${failed.error ?? "unknown error"}`);
            const result = data.results?.find((item) => item.url === url) ?? data.results?.[0];
            return {
                title: url,
                content: requireText(result?.raw_content, `${label} content`),
            };
        },
    };
}
