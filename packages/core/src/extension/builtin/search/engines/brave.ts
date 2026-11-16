import type { BraveEngineConfig, SearchEngine } from "../types.js";
import { engineTimeout, joinUrl, queryString, requestJson } from "../utils.js";

interface BraveResponse {
    web?: {
        results?: Array<{
            title?: string;
            url?: string;
            description?: string;
            page_age?: string;
            extra_snippets?: string[];
        }>;
    };
}

export function createBraveEngine(config: BraveEngineConfig, pluginTimeout: number): SearchEngine {
    const timeoutMs = engineTimeout(config, pluginTimeout);

    return {
        id: config.id,
        backend: config.backend,

        async search({ query, limit, signal }) {
            const queryParams = queryString({
                q: query,
                count: Math.min(limit, 20),
                country: config.country,
                search_lang: config.searchLang,
                safesearch: config.safesearch,
                text_decorations: false,
                extra_snippets: config.extraSnippets || undefined,
            });
            const data = await requestJson<BraveResponse>(`${joinUrl(config.endpoint, "/web/search")}${queryParams}`, {
                headers: {
                    accept: "application/json",
                    "x-subscription-token": config.apiKey,
                },
                timeoutMs,
                signal,
            });
            const results = (data.web?.results ?? []).flatMap((item) => {
                if (!item.url) return [];
                const snippets = [item.description ?? "", ...(item.extra_snippets ?? [])].filter((text) => text.length > 0);
                return [
                    {
                        title: item.title?.trim() || item.url,
                        url: item.url,
                        snippet: snippets.join("\n"),
                        publishedAt: item.page_age,
                    },
                ];
            });
            return { results };
        },
    };
}
