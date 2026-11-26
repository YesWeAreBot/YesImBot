import type { FetchedPage, FirecrawlEngineConfig, SearchEngine } from "../types.js";
import { engineTimeout, joinUrl, requestJson, requireText } from "../utils.js";

interface FirecrawlSearchResponse {
    success?: boolean;
    error?: string;
    data?: {
        web?: Array<{
            title?: string;
            url?: string;
            description?: string;
        }>;
    };
}

interface FirecrawlScrapeResponse {
    success?: boolean;
    error?: string;
    data?: {
        markdown?: string;
        metadata?: { title?: string };
    };
}

export function createFirecrawlEngine(config: FirecrawlEngineConfig, pluginTimeout: number): SearchEngine {
    const timeoutMs = engineTimeout(config, pluginTimeout);
    const label = `Firecrawl (${config.id})`;

    return {
        id: config.id,
        backend: config.backend,

        async search({ query, limit, signal }) {
            const data = await requestJson<FirecrawlSearchResponse>(joinUrl(config.endpoint, "/search"), {
                method: "POST",
                headers: { authorization: `Bearer ${config.apiKey}` },
                body: { query, limit, sources: ["web"] },
                timeoutMs,
                signal,
            });
            if (data.success === false) throw new Error(`${label} search failed: ${data.error ?? "unknown error"}`);
            const results = (data.data?.web ?? []).flatMap((item) => {
                if (!item.url) return [];
                return [
                    {
                        title: item.title?.trim() || item.url,
                        url: item.url,
                        snippet: item.description ?? "",
                    },
                ];
            });
            return { results };
        },

        async fetchPage(url, signal): Promise<FetchedPage> {
            const data = await requestJson<FirecrawlScrapeResponse>(joinUrl(config.endpoint, "/scrape"), {
                method: "POST",
                headers: { authorization: `Bearer ${config.apiKey}` },
                body: { url, formats: ["markdown"], onlyMainContent: true },
                timeoutMs,
                signal,
            });
            if (data.success === false) throw new Error(`${label} scrape failed: ${data.error ?? "unknown error"}`);
            return {
                title: data.data?.metadata?.title?.trim() || url,
                content: requireText(data.data?.markdown, `${label} content`),
            };
        },
    };
}
