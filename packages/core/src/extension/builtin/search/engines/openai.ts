import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type ToolSet } from "ai";

import type { OpenaiEngineConfig, SearchEngine, SearchHit } from "../types.js";
import { engineTimeout, normalizeUrl, timeoutSignal } from "../utils.js";

interface OpenaiSearchOutput {
    sources?: Array<{ type: string; url?: string }>;
}

export function createOpenaiEngine(config: OpenaiEngineConfig, pluginTimeout: number): SearchEngine {
    if (config.allowedDomains.length > 0 && config.blockedDomains.length > 0) {
        throw new Error(`OpenAI (${config.id}) cannot set both allowedDomains and blockedDomains`);
    }
    const timeoutMs = engineTimeout(config, pluginTimeout);
    const label = `OpenAI (${config.id})`;
    const provider = createOpenAI({ apiKey: config.apiKey, baseURL: config.endpoint });
    const model = provider.responses(config.model);
    const filters =
        config.allowedDomains.length > 0 || config.blockedDomains.length > 0
            ? {
                  ...(config.allowedDomains.length > 0 ? { allowedDomains: config.allowedDomains } : {}),
                  ...(config.blockedDomains.length > 0 ? { blockedDomains: config.blockedDomains } : {}),
              }
            : undefined;

    return {
        id: config.id,
        backend: config.backend,

        async search({ query, limit, signal }) {
            const response = await generateText({
                model,
                prompt: `Search the web for:\n${query}\n\nAnswer the query using the retrieved sources.`,
                tools: {
                    web_search: provider.tools.webSearch({
                        searchContextSize: config.searchContextSize,
                        ...(filters ? { filters } : {}),
                    }),
                } as unknown as ToolSet,
                toolChoice: { type: "tool", toolName: "web_search" },
                maxRetries: 0,
                maxOutputTokens: config.maxOutputTokens,
                abortSignal: timeoutSignal(signal, timeoutMs),
            });

            const hits = new Map<string, SearchHit>();
            for (const item of response.toolResults) {
                if (item.toolName !== "web_search") continue;
                if ("isError" in item && item.isError) throw new Error(`${label} search failed: ${JSON.stringify(item.output)}`);
                const output = item.output as OpenaiSearchOutput | undefined;
                for (const source of output?.sources ?? []) {
                    if (source.type !== "url" || !source.url) continue;
                    const key = normalizeUrl(source.url);
                    if (hits.has(key)) continue;
                    hits.set(key, { title: source.url, url: source.url, snippet: "" });
                }
            }
            for (const source of response.sources) {
                if (source.sourceType !== "url") continue;
                const key = normalizeUrl(source.url);
                const existing = hits.get(key);
                hits.set(key, {
                    title: source.title?.trim() || existing?.title || source.url,
                    url: source.url,
                    snippet: existing?.snippet ?? "",
                });
            }

            return {
                results: [...hits.values()].slice(0, limit),
                answers: response.text.length > 0 ? [response.text] : undefined,
            };
        },
    };
}
