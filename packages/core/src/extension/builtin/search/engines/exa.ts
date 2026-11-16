import type { ExaEngineConfig, FetchedPage, SearchEngine } from "../types.js";
import { engineTimeout, joinUrl, requestJson, requireText } from "../utils.js";

interface ExaResult {
    id?: string;
    title?: string;
    url?: string;
    text?: string;
    summary?: string;
    highlights?: string[];
    publishedDate?: string;
}

interface ExaSearchResponse {
    results?: ExaResult[];
}

interface ExaContentsResponse {
    results?: ExaResult[];
    statuses?: Array<{ id?: string; status?: string; error?: string }>;
}

export function createExaEngine(config: ExaEngineConfig, pluginTimeout: number): SearchEngine {
    const timeoutMs = engineTimeout(config, pluginTimeout);
    const label = `Exa (${config.id})`;

    return {
        id: config.id,
        backend: config.backend,

        async search({ query, limit, signal }) {
            const data = await requestJson<ExaSearchResponse>(joinUrl(config.endpoint, "/search"), {
                method: "POST",
                headers: { authorization: `Bearer ${config.apiKey}` },
                body: {
                    query,
                    type: config.type,
                    numResults: limit,
                    contents: { text: { maxCharacters: 2000 } },
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
                        snippet: item.text ?? item.summary ?? item.highlights?.join("\n") ?? "",
                        publishedAt: item.publishedDate,
                    },
                ];
            });
            return { results };
        },

        async fetchPage(url, signal): Promise<FetchedPage> {
            const data = await requestJson<ExaContentsResponse>(joinUrl(config.endpoint, "/contents"), {
                method: "POST",
                headers: { authorization: `Bearer ${config.apiKey}` },
                body: { ids: [url], text: { maxCharacters: 100_000 } },
                timeoutMs,
                signal,
            });
            const status = data.statuses?.find((item) => item.id === url);
            if (status && status.status !== "success") {
                throw new Error(`${label} contents failed: ${status.error ?? status.status}`);
            }
            const result = data.results?.find((item) => item.url === url) ?? data.results?.[0];
            return {
                title: result?.title?.trim() || url,
                content: requireText(result?.text, `${label} content`),
            };
        },
    };
}
