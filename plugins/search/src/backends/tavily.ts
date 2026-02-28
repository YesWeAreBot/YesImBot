import { Context, Schema } from "koishi";

import type { SearchBackend, SearchOptions, SearchPluginConfig, SearchResult } from "../types";

interface TavilyResult {
  url: string;
  title: string;
  content: string;
  score: number;
  raw_content: string | null;
  favicon: string | null;
}

interface TavilyResponse {
  query: string;
  follow_up_questions: string[] | null;
  answer: string | null;
  images: string[];
  results: Array<TavilyResult>;
}

interface TavilyRequest {
  query: string;
  search_depth: "basic" | "advanced" | "fast" | "ultra-fast";
  topic?: "news" | "finance" | "general";
  max_results?: number;
  time_range?: "day" | "week" | "month" | "year" | "none";
  start_date?: string; // ISO 8601 date string, e.g. "2024-01-01"
  end_date?: string; // ISO 8601 date string, e.g. "2024-12-31"
  include_images?: boolean;
  include_image_descriptions?: boolean;
  include_favicon?: boolean;
  include_usage?: boolean;
  include_raw_content?: "none" | "text" | "markdown";
}

export class TavilyBackend implements SearchBackend {
  readonly name = "tavily";

  constructor(
    private ctx: Context,
    private config: SearchPluginConfig,
  ) {}

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    if (!this.config.apiKey) return [];

    const endpoint = "https://api.tavily.com/search";
    const maxResults = options.limit ?? this.config.defaultLimit ?? 5;

    try {
      const response: TavilyResponse = await this.ctx.http.post(
        endpoint,
        {
          query,
          search_depth: "basic",
          max_results: maxResults,
        } as TavilyRequest,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
            "User-Agent": "YesImBot Search Plugin",
          },
        },
      );

      const results = response.results;
      if (!Array.isArray(results)) return [];

      return results.map((r) => ({
        title: String(r.title ?? ""),
        url: String(r.url ?? ""),
        snippet: String(r.content ?? ""),
      }));
    } catch (e) {
      this.ctx.logger.error(`[TavilyBackend] Search request failed: ${e}`);
      return [];
    }
  }

  getParameterSchema(): Record<string, Schema> {
    return {
      limit: Schema.number().default(5).description("Maximum number of results to return"),
    };
  }
}
