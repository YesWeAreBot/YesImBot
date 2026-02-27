import { Context, Schema } from "koishi";

import { Plugin } from "../base-plugin";
import { Metadata, Tool, withInnerThoughts } from "../decorators";
import type { ToolExecutionContext, ToolResult } from "../types";
import { Failed, Success } from "../utils";

@Metadata({
  name: "demo",
  description: "A demo plugin showcasing how to create custom tools.",
  builtin: true,
})
export class DemoPlugin extends Plugin {
  constructor(private ctx: Context) {
    super();
  }

  @Tool({
    name: "get_weather",
    description: "Get the current weather in a specified city.",
    parameters: withInnerThoughts({
      city: Schema.string().required().description("The name of the city to get the weather for."),
    }),
    activators: [],
    hidden: true,
  })
  async getWeather(
    params: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    const city = String(params["city"] ?? "");
    // Simulate fetching weather data (replace with actual API call if needed)
    const weatherData = {
      city,
      temperature: "25°C",
      condition: "Sunny",
    };
    return Success(weatherData);
  }

  @Tool({
    name: "web_search",
    description: "Search the web for a query and return the top result.",
    parameters: withInnerThoughts({
      query: Schema.string().required().description("The search query to look up on the web."),
    }),
    activators: [],
    hidden: true,
  })
  async webSearch(params: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolResult> {
    const query = String(params["query"] ?? "");
    // Simulate a web search (replace with actual search API call if needed)
    const searchResult = {
      query,
      title: "500 Internal Server Error - Simulated Search Result",
      url: "https://www.example.com/search-result",
      snippet: "Search engine currently unavailable.",
    };
    return Failed(JSON.stringify(searchResult));
  }
}
