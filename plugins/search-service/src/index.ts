import { Metadata, YesImPlugin } from "@yesimbot/plugin-sdk";
import { Context, Schema } from "koishi";

import { TavilyBackend } from "./backends/tavily";
import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import type { SearchBackend, SearchPluginConfig } from "./types";

@Metadata({
  name: "search",
  description: "Web search tool",
})
export default class SearchPlugin extends YesImPlugin {
  static name = "search";
  static inject = ["yesimbot.plugin"];
  static Config: Schema<SearchPluginConfig> = Schema.object({
    provider: Schema.string().default("tavily"),
    apiKey: Schema.string().required(),
    endpoint: Schema.string(),
    defaultLimit: Schema.number().default(5),
    jinaApiKey: Schema.string(),
  }).i18n({
    "zh-CN": zhCN,
    "en-US": enUS,
  });
  private config: SearchPluginConfig;

  constructor(ctx: Context, config: SearchPluginConfig) {
    super(ctx);
    this.config = config;
    this.ctx.on("ready", async () => this.start());
  }

  private async start(): Promise<void> {
    const backend: SearchBackend = new TavilyBackend(this.ctx, this.config);
    this.registerTool({
      name: "search",
      description:
        "Search the web for current information, news, facts, or web content. " +
        "Use when user asks about recent events, needs fact-checking, or requires information " +
        "that may not be in training data. Returns relevant results with titles, URLs, and snippets. " +
        "For detailed content from search results, use the 'fetch' tool with the URL.",
      inputSchema: Schema.object({
        query: Schema.string()
          .required()
          .description("Search query - use clear, specific keywords for best results"),
        ...backend.getParameterSchema(),
      }),
      execute: async (input) => {
        const params = input as { query?: string; limit?: number };
        const query = params.query ?? "";
        const limit = params.limit;
        const results = await backend.search(query, { limit });

        if (results.length === 0) return "No results found.";

        const formatted = results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
          .join("\n\n");

        return formatted;
      },
    });
  }
}
