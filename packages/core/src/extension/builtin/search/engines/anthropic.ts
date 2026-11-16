import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, type ToolSet } from "ai";

import type { AnthropicEngineConfig, SearchEngine, SearchHit } from "../types.js";
import { engineTimeout, normalizeUrl, requireText, timeoutSignal } from "../utils.js";

interface AnthropicSearchResult {
    url: string;
    title?: string | null;
    pageAge?: string | null;
}

export function createAnthropicEngine(config: AnthropicEngineConfig, pluginTimeout: number): SearchEngine {
    if (config.allowedDomains.length > 0 && config.blockedDomains.length > 0) {
        throw new Error(`Anthropic (${config.id}) cannot set both allowedDomains and blockedDomains`);
    }
    const timeoutMs = engineTimeout(config, pluginTimeout);
    const label = `Anthropic (${config.id})`;
    const provider = createAnthropic({ apiKey: config.apiKey, baseURL: config.endpoint });
    const model = provider(config.model);
    const domains = {
        ...(config.allowedDomains.length > 0 ? { allowedDomains: config.allowedDomains } : {}),
        ...(config.blockedDomains.length > 0 ? { blockedDomains: config.blockedDomains } : {}),
    };

    return {
        id: config.id,
        backend: config.backend,

        async search({ query, limit, signal }) {
            const response = await generateText({
                model,
                prompt: `Use the web_search tool to search the web for:\n${query}\n\nAnswer the query using the retrieved sources.`,
                tools: {
                    web_search: provider.tools.webSearch_20260318({
                        maxUses: config.maxUses,
                        ...domains,
                    }),
                } as unknown as ToolSet,
                maxRetries: 0,
                maxOutputTokens: config.maxTokens,
                abortSignal: timeoutSignal(signal, timeoutMs),
            });

            const hits = new Map<string, SearchHit>();
            for (const source of response.sources) {
                if (source.sourceType !== "url") continue;
                const metadata = source.providerMetadata?.anthropic as { citedText?: string } | undefined;
                hits.set(normalizeUrl(source.url), {
                    title: source.title?.trim() || source.url,
                    url: source.url,
                    snippet: metadata?.citedText ?? "",
                });
            }
            for (const item of response.toolResults) {
                if (item.toolName !== "web_search") continue;
                if ("isError" in item && item.isError) throw new Error(`${label} search failed: ${JSON.stringify(item.output)}`);
                const output = item.output as AnthropicSearchResult[] | undefined;
                if (!Array.isArray(output)) throw new Error(`${label} search returned an unexpected tool result`);
                for (const result of output) {
                    if (!result.url) continue;
                    const url = result.url;
                    const key = normalizeUrl(url);
                    const existing = hits.get(key);
                    hits.set(key, {
                        title: result.title?.trim() || existing?.title || url,
                        url,
                        snippet: existing?.snippet ?? "",
                        ...(result.pageAge ? { publishedAt: result.pageAge } : {}),
                    });
                }
            }

            return {
                results: [...hits.values()].slice(0, limit),
                answers: response.text.length > 0 ? [response.text] : undefined,
            };
        },

        async fetchPage(url, signal) {
            const response = await generateText({
                model,
                prompt: `Use the web_fetch tool to fetch this URL:\n${url}`,
                tools: {
                    web_fetch: provider.tools.webFetch_20260318({
                        maxUses: 1,
                        maxContentTokens: config.maxContentTokens,
                        ...domains,
                    }),
                } as unknown as ToolSet,
                maxRetries: 0,
                maxOutputTokens: config.maxTokens,
                abortSignal: timeoutSignal(signal, timeoutMs),
            });

            const item = response.toolResults.find((result) => result.toolName === "web_fetch");
            if (!item) throw new Error(`${label} fetch did not use web_fetch for ${url}`);
            if ("isError" in item && item.isError) throw new Error(`${label} fetch failed: ${JSON.stringify(item.output)}`);

            const output = item.output as {
                type?: string;
                content?: {
                    title?: string | null;
                    source?: { type?: string; media_type?: string; data?: string };
                };
            };
            if (output.type !== "web_fetch_result") throw new Error(`${label} fetch returned ${output.type ?? "no result"} for ${url}`);
            const source = output.content?.source;
            if (!source) throw new Error(`${label} fetch returned a document without source`);
            if (source.type !== "text") throw new Error(`${label} fetch returned non-text content (${source.media_type ?? source.type})`);
            return {
                title: output.content?.title?.trim() || url,
                content: requireText(source.data, `${label} content`),
            };
        },
    };
}
