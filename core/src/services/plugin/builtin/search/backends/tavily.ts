import { Context, Schema } from "koishi";

import type { SearchBackend, SearchOptions, SearchPluginConfig, SearchResult } from "../types";

export class TavilyBackend implements SearchBackend {
  readonly name = "tavily";

  constructor(
    private ctx: Context,
    private config: SearchPluginConfig,
  ) {}

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    if (!this.config.apiKey) return [];

    const endpoint = this.config.endpoint ?? "https://api.tavily.com/search";
    const maxResults = options.limit ?? this.config.defaultLimit ?? 5;

    try {
      const response = await this.ctx.http.post(endpoint, {
        api_key: this.config.apiKey,
        query,
        max_results: maxResults,
      });

      const results = (response as { results?: Array<Record<string, unknown>> }).results;
      if (!Array.isArray(results)) return [];

      return results.map((r) => ({
        title: String(r.title ?? ""),
        url: String(r.url ?? ""),
        snippet: String(r.content ?? ""),
      }));
    } catch {
      return [];
    }
  }

  getParameterSchema(): Record<string, Schema> {
    return {
      limit: Schema.number().default(5).description("Maximum number of results to return"),
    };
  }
}
