import { join } from "node:path";

import {
  Failed,
  FunctionType,
  Metadata,
  Success,
  Tool,
  ToolResult,
  withInnerThoughts,
  YesImPlugin,
} from "@yesimbot/plugin-sdk/tools";
import { Context, Schema } from "koishi";
import { loadSkillsFromDir } from "koishi-plugin-yesimbot/services/skill";

import { TavilyBackend } from "./backends/tavily";
import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import type { SearchBackend, SearchPluginConfig } from "./types";

const builtinSkillsDir = join(__dirname, "../", "resources/skills");

@Metadata({ name: "search", description: "Web search tool" })
export default class SearchPlugin extends YesImPlugin {
  static name = "search";
  static inject = ["yesimbot.plugin", "yesimbot.skill", "yesimbot.hook"];
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

  private disposeSkills: (() => void)[] = [];

  constructor(ctx: Context, config: SearchPluginConfig) {
    super(ctx);
    this.config = config;
    this.ctx.on("ready", async () => this.start());
    this.ctx.on("dispose", async () => this.dispose());
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
      type: FunctionType.Tool,
      hidden: true,
      parameters: withInnerThoughts({
        query: Schema.string()
          .required()
          .description("Search query - use clear, specific keywords for best results"),
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

    const skills = loadSkillsFromDir(builtinSkillsDir);
    this.disposeSkills = skills.map((s) => this.ctx["yesimbot.skill"].register(s));
  }

  private async dispose(): Promise<void> {
    this.disposeSkills.forEach((d) => d());
  }

  @Tool({
    name: "fetch",
    description:
      "Fetch and parse a web page's full content using Jina AI Reader. " +
      "Use after 'search' to read detailed content from specific URLs. " +
      "Extracts main content while removing ads, navigation, and clutter.",
    parameters: withInnerThoughts({
      url: Schema.string()
        .required()
        .description("URL of the web page to fetch (must be a valid http/https URL)"),
    }),
    hidden: true,
  })
  private async fetch(url: string): Promise<ToolResult<string | unknown>> {
    if (!this.config.jinaApiKey) {
      return Failed("Jina AI API key not configured. Please set jinaApiKey in plugin config.");
    }

    const response = await this.ctx.http.get(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${this.config.jinaApiKey}`,
      },
    });
    if (response.status !== 200) {
      return Failed(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }
    const data = response.data;
    if (typeof data !== "string") {
      return Failed("Unexpected response format from Jina AI Reader");
    }
    return Success(data);
  }
}
