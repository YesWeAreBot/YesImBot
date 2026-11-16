import type { DeepseekEngineConfig, FetchedPage, SearchEngine } from "../types.js";
import { engineTimeout, joinUrl, requestJson, requireText } from "../utils.js";

interface DeepseekSearchResponse {
    results?: Array<{
        title?: string;
        url?: string;
        snippet?: string;
        summary?: string;
        content?: string;
        date?: string;
    }>;
}

interface DeepseekFetchResponse {
    title?: string;
    content?: string;
}

export function createDeepseekEngine(config: DeepseekEngineConfig, pluginTimeout: number): SearchEngine {
    const timeoutMs = engineTimeout(config, pluginTimeout);
    const label = `DeepSeek (${config.id})`;

    return {
        id: config.id,
        backend: config.backend,

        async search({ query, limit, signal }) {
            const data = await requestJson<DeepseekSearchResponse>(joinUrl(config.endpoint, "/v1/tools/search"), {
                method: "POST",
                headers: { authorization: `Bearer ${config.apiKey}` },
                body: { query, count: limit, need_content: config.needContent },
                timeoutMs,
                signal,
            });
            const results = (data.results ?? []).flatMap((item) => {
                if (!item.url) return [];
                return [
                    {
                        title: item.title?.trim() || item.url,
                        url: item.url,
                        snippet: config.needContent ? item.content || item.summary || item.snippet || "" : item.summary || item.snippet || "",
                        publishedAt: item.date,
                    },
                ];
            });
            return { results };
        },

        async fetchPage(url, signal): Promise<FetchedPage> {
            const data = await requestJson<DeepseekFetchResponse>(joinUrl(config.endpoint, "/v1/tools/fetch"), {
                method: "POST",
                headers: { authorization: `Bearer ${config.apiKey}` },
                body: { url },
                timeoutMs,
                signal,
            });
            return {
                title: data.title?.trim() || url,
                content: requireText(data.content, `${label} content`),
            };
        },
    };
}
