import { Context, Logger, Schema, Service } from "koishi";
import type { ExtensionContext, ToolDefinition } from "koishi-plugin-yesimbot";

import { createSearXNGBackend, searxngConfigSchema, type SearXNGConfig } from "./backends/searxng";
import { createTavilyBackend, tavilyConfigSchema, type TavilyConfig } from "./backends/tavily";
import type { SearchBackend, SearchRuntimeConfig } from "./types";

type SearchProviderName = "tavily" | "searxng";

interface SearchServiceConfig {
  provider?: SearchProviderName;
  defaultLimit?: number;
  maxLimit?: number;
  timeoutMs?: number;
  blacklist?: string[];
  tavily?: TavilyConfig;
  searxng?: SearXNGConfig;
}

const DEFAULT_PROVIDER: SearchProviderName = "tavily";

function formatSearchPrompt(provider: string, hasScrape: boolean): string {
  const lines = [
    "",
    "## Web Search",
    "",
    `You have access to web search via the \`web_search\` tool (provider: ${provider}).`,
    "Use it when you need current, external, or source-backed web information.",
    "It returns structured JSON with URLs and snippets.",
  ];

  if (hasScrape) {
    lines.push("For detailed page content, use the `web_scrape` tool on candidate URLs.");
  }

  lines.push("");
  return lines.join("\n");
}

export default class SearchService extends Service<SearchServiceConfig> {
  static name = "yesimbot-search-service";
  static inject = ["yesimbot.extension"];

  static Config: Schema<SearchServiceConfig> = Schema.intersect([
    Schema.object({
      provider: Schema.union([Schema.const("tavily"), Schema.const("searxng")])
        .default(DEFAULT_PROVIDER)
        .description("搜索后端"),
      defaultLimit: Schema.number().default(5).description("默认返回结果数"),
      maxLimit: Schema.number().default(10).description("最大返回结果数"),
      timeoutMs: Schema.number().default(10_000).description("请求超时（毫秒）"),
      blacklist: Schema.array(Schema.string()).default([]).description("URL 黑名单正则"),
    }),
    Schema.union([
      Schema.object({
        provider: Schema.const("tavily"),
        tavily: tavilyConfigSchema,
      }),
      Schema.object({
        provider: Schema.const("searxng"),
        searxng: searxngConfigSchema,
      }),
    ]),
  ]);

  public readonly logger: Logger;

  private backend?: SearchBackend;

  constructor(ctx: Context, config: SearchServiceConfig) {
    super(ctx, config);
    this.ctx = ctx;
    this.config = config;
    this.logger = ctx.logger("yesimbot.search-service");
  }

  override async start(): Promise<void> {
    const provider = this.config.provider ?? DEFAULT_PROVIDER;
    const runtime: SearchRuntimeConfig = {
      defaultLimit: this.config.defaultLimit ?? 5,
      maxLimit: this.config.maxLimit ?? 10,
      timeoutMs: this.config.timeoutMs ?? 10_000,
      blacklist: this.config.blacklist ?? [],
    };

    switch (provider) {
      case "tavily":
        this.backend = createTavilyBackend(this.ctx, this.config.tavily!, runtime, this.logger);
        break;
      case "searxng":
        this.backend = createSearXNGBackend(this.ctx, this.config.searxng!, runtime, this.logger);
        break;
      default:
        throw new Error(`Unsupported search provider: ${provider}`);
    }

    const backend = this.backend;
    const hasScrape = typeof backend.createScrapeTool === "function";

    await this.ctx["yesimbot.extension"].registerExtension({
      id: "search-service",
      setup(ctx: ExtensionContext) {
        ctx.on("agent:before-start", (event) => ({
          systemPrompt: event.systemPrompt + formatSearchPrompt(backend.name, hasScrape),
        }));

        ctx.tool.register(backend.createSearchTool() as ToolDefinition);

        const scrapeTool = backend.createScrapeTool?.();
        if (scrapeTool) {
          ctx.tool.register(scrapeTool as ToolDefinition);
        }
      },
    });

    this.logger.info(`Search service started with provider: ${provider}`);
  }

  override async stop(): Promise<void> {
    await this.ctx["yesimbot.extension"].unregisterExtension("search-service");
  }
}
