import type { Context, Logger } from "koishi";
import { Schema } from "koishi";
import type { ToolDefinition } from "koishi-plugin-yesimbot";
import { z } from "zod";

import type { SearchBackend, SearchRuntimeConfig, WebSearchOutput } from "../types";
import { clampLimit, compileBlacklist, dedupeByUrl, filterBlockedResults } from "../utils";

type SearXNGSafeSearch = 0 | 1 | 2;
type SearXNGTimeRange = "day" | "month" | "year";

export interface SearXNGConfig {
  endpoint: string;
  engines?: string[];
  language?: string;
  categories?: string[];
  safeSearch?: SearXNGSafeSearch;
  username?: string;
  password?: string;
}

interface SearXNGRuntimeConfig extends SearchRuntimeConfig, SearXNGConfig {}

interface SearXNGSearchInput {
  query: string;
  limit?: number;
  engines?: string[];
  language?: string;
  categories?: string[];
  timeRange?: SearXNGTimeRange;
  safeSearch?: SearXNGSafeSearch;
}

interface SearXNGResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  engine?: string;
  category?: string;
}

interface SearXNGResponse {
  results?: SearXNGResult[];
}

export const searxngConfigSchema: Schema<SearXNGConfig> = Schema.object({
  endpoint: Schema.string().required().description("SearXNG 实例地址"),
  engines: Schema.array(Schema.string()).default([]).description("搜索引擎列表"),
  language: Schema.string().description("搜索语言"),
  categories: Schema.array(Schema.string()).default([]).description("搜索类别"),
  safeSearch: Schema.union([Schema.const(0), Schema.const(1), Schema.const(2)]).description(
    "安全搜索级别",
  ),
  username: Schema.string().description("HTTP Basic 用户名"),
  password: Schema.string().description("HTTP Basic 密码"),
});

const searchInputSchema = z.object({
  query: z.string().min(1).describe("Search query."),
  limit: z.number().int().positive().optional().describe("Maximum number of results."),
  engines: z.array(z.string()).optional(),
  language: z.string().optional(),
  categories: z.array(z.string()).optional(),
  timeRange: z.enum(["day", "month", "year"]).optional(),
  safeSearch: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
});

export function createSearXNGBackend(
  ctx: Context,
  config: SearXNGConfig | undefined,
  runtime: SearchRuntimeConfig,
  logger: Logger,
): SearchBackend {
  if (!config?.endpoint) {
    throw new Error("SearXNG provider requires searxng.endpoint to be configured");
  }

  return new SearXNGBackend(ctx, { ...runtime, ...config }, logger);
}

function normalizeSearchUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, "");
  if (trimmed.endsWith("/search")) return trimmed;
  return `${trimmed}/search`;
}

class SearXNGBackend implements SearchBackend {
  readonly name = "searxng";

  private readonly blacklist: RegExp[];

  constructor(
    private readonly ctx: Context,
    private readonly config: SearXNGRuntimeConfig,
    private readonly logger: Logger,
  ) {
    this.blacklist = compileBlacklist(config.blacklist);
  }

  createSearchTool(): ToolDefinition<SearXNGSearchInput, WebSearchOutput> {
    return {
      name: "web_search",
      description:
        "Search the web for current information, news, facts, or web content. " +
        "Returns structured JSON with titles, URLs, and snippets.",
      promptSnippet: "Search the web for current information",
      promptGuidelines: [
        "Use web_search for recent events, facts, or information not in training data.",
      ],
      inputSchema: searchInputSchema,
      execute: async (input) => this.search(input),
    };
  }

  private async search(input: SearXNGSearchInput): Promise<WebSearchOutput> {
    const limit = clampLimit(input.limit, this.config.defaultLimit, this.config.maxLimit);
    const engines = input.engines ?? this.config.engines;
    const categories = input.categories ?? this.config.categories;
    const params: Record<string, string | undefined> = {
      q: input.query,
      format: "json",
      engines: engines?.join(","),
      categories: categories?.join(","),
      language: input.language ?? this.config.language,
      time_range: input.timeRange,
      safesearch:
        input.safeSearch != null
          ? String(input.safeSearch)
          : this.config.safeSearch != null
            ? String(this.config.safeSearch)
            : undefined,
    };
    const headers: Record<string, string> = {};

    if (this.config.username && this.config.password) {
      const credentials = Buffer.from(
        `${this.config.username}:${this.config.password}`,
      ).toString("base64");
      headers.Authorization = `Basic ${credentials}`;
    }

    try {
      const response = await this.ctx.http.get<SearXNGResponse>(
        normalizeSearchUrl(this.config.endpoint),
        { params, headers, timeout: this.config.timeoutMs },
      );
      const rawResults = Array.isArray(response.results) ? response.results : [];
      const mapped = rawResults.map((result) => ({
        title: result.title ?? "",
        url: result.url ?? "",
        snippet: result.content ?? "",
        score: result.score,
        metadata: {
          ...(result.engine ? { engine: result.engine } : {}),
          ...(result.category ? { category: result.category } : {}),
        },
      }));
      const filtered = filterBlockedResults(mapped, this.blacklist);
      const deduped = dedupeByUrl(filtered).slice(0, limit);

      return { provider: this.name, query: input.query, results: deduped };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[SearXNGBackend] Search failed: ${message}`);
      return {
        provider: this.name,
        query: input.query,
        results: [],
        error: { message, code: "request_failed" },
      };
    }
  }
}
