import { FunctionType, Metadata, Plugin, Success, withInnerThoughts } from "@yesimbot/plugin";
import { Context, Schema } from "koishi";

import { TavilyBackend } from "./backends/tavily";
import type { SearchBackend, SearchPluginConfig } from "./types";

interface SkillDefinition {
  name: string;
  description?: string;
  effects: {
    tools?: { include?: string[]; exclude?: string[] };
  };
  lifecycle: "per-turn" | "sticky" | "trait-bound";
  source: "file" | "plugin";
}

interface SkillRegistry {
  register(def: SkillDefinition): () => void;
}

declare module "koishi" {
  interface Context {
    "yesimbot.skill": SkillRegistry;
  }
}

@Metadata({ name: "search", description: "Web search tool" })
export default class SearchPlugin extends Plugin {
  static name = "search";
  static inject = ["yesimbot.plugin", "yesimbot.skill"];
  static Config: Schema<SearchPluginConfig> = Schema.object({
    provider: Schema.string().default("tavily").description("Search backend provider to use"),
    apiKey: Schema.string().required().description("API key for the search backend"),
    endpoint: Schema.string().description("Endpoint URL for the search backend"),
    defaultLimit: Schema.number()
      .default(5)
      .description("Default number of search results to return"),
  });

  constructor(ctx: Context, config: SearchPluginConfig) {
    super(ctx);
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

    // Register skill for search tool activation
    const skillDispose = this.ctx["yesimbot.skill"].register({
      name: "web-search",
      description: "Enable web search capability",
      lifecycle: "per-turn",
      effects: {
        tools: { include: ["search"] },
      },
      source: "plugin",
    });

    this.ctx.on("ready", () => {
      this.ctx["yesimbot.plugin"].registerPlugin(this);
    });

    this.ctx.on("dispose", () => {
      skillDispose();
      this.ctx["yesimbot.plugin"].unregisterPlugin(this.metadata.name);
    });
  }
}
