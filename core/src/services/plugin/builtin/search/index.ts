import { Context, Schema } from "koishi";

import { Plugin } from "../../base-plugin";
import { Metadata, withInnerThoughts } from "../../decorators";
import { FunctionType } from "../../types";
import { Success } from "../../utils";
import { TavilyBackend } from "./backends/tavily";
import type { SearchBackend, SearchPluginConfig } from "./types";

@Metadata({ name: "search", description: "Web search tool", builtin: true })
export class SearchPlugin extends Plugin {
  constructor(ctx: Context, config: SearchPluginConfig) {
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
  }
}
