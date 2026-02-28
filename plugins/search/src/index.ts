import { FunctionType, Metadata, Plugin, Success, withInnerThoughts } from "@yesimbot/plugin";
import { Context, Schema } from "koishi";

declare module "koishi" {
  export interface Context {
    "yesimbot.plugin": {
      registerPlugin(plugin: Plugin): void;
    };
  }
}

import { TavilyBackend } from "./backends/tavily";
import type { SearchBackend, SearchPluginConfig } from "./types";

@Metadata({ name: "search", description: "Web search tool" })
export default class SearchPlugin extends Plugin {
  static name = "search";
  static inject = ["yesimbot.plugin"];
  static Config: Schema<SearchPluginConfig> = Schema.object({
    provider: Schema.string().default("tavily").description("Search backend provider to use"),
    apiKey: Schema.string().required().description("API key for the search backend"),
    endpoint: Schema.string().description("Endpoint URL for the search backend"),
    defaultLimit: Schema.number()
      .default(5)
      .description("Default number of search results to return"),
  });

  constructor(
    private ctx: Context,
    private config: SearchPluginConfig,
  ) {
    super();

    const backend: SearchBackend = new TavilyBackend(ctx, config);

    this.registerTool({
      name: "search",
      description:
        "Search the web for information. Returns a list of relevant results with titles, URLs, and snippets.",
      type: FunctionType.Tool,
      hidden: true,
      parameters: withInnerThoughts({
        query: Schema.string().required().description("Search query"),
        ...backend.getParameterSchema(),
      }),
      handler: async (params) => {
        const query = params.query as string;
        const limit = params.limit as number | undefined;
        const results = await backend.search(query, { limit });

        if (results.length === 0) return Success("No results found.");

        const formatted = results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
          .join("\n\n");

        return Success(formatted);
      },
    });

    this.ctx["yesimbot.plugin"].registerPlugin(this);
  }
}
