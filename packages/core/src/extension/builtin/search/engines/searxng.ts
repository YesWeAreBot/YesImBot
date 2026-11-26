import type { SearxngEngineConfig, SearchEngine } from "../types.js";
import { engineTimeout, joinUrl, queryString, requestJson } from "../utils.js";

interface SearxngResponse {
    results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        publishedDate?: string;
    }>;
}

export function createSearxngEngine(config: SearxngEngineConfig, pluginTimeout: number): SearchEngine {
    const timeoutMs = engineTimeout(config, pluginTimeout);
    const headers: Record<string, string> = { accept: "application/json" };
    if (config.apiKey.length > 0) headers.authorization = `Bearer ${config.apiKey}`;

    return {
        id: config.id,
        backend: config.backend,

        async search({ query, limit, signal }) {
            const queryParams = queryString({
                q: query,
                format: "json",
                categories: config.categories.join(","),
                language: config.language,
                safesearch: config.safesearch,
                pageno: 1,
            });
            const data = await requestJson<SearxngResponse>(`${joinUrl(config.endpoint, "/search")}${queryParams}`, {
                headers,
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
                        publishedAt: item.publishedDate,
                    },
                ];
            });
            return { results: results.slice(0, limit) };
        },
    };
}
