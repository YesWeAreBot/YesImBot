import type { Context } from "koishi";

import type { EngineConfig, SearchEngine } from "../types.js";
import { createAnthropicEngine } from "./anthropic.js";
import { createBraveEngine } from "./brave.js";
import { createDeepseekEngine } from "./deepseek.js";
import { createExaEngine } from "./exa.js";
import { createFirecrawlEngine } from "./firecrawl.js";
import { createOpenaiEngine } from "./openai.js";
import { createSearxngEngine } from "./searxng.js";
import { createTavilyEngine } from "./tavily.js";

function createEngine(config: EngineConfig, pluginTimeout: number, ctx?: Context): SearchEngine {
    switch (config.backend) {
        case "tavily":
            return createTavilyEngine(config, pluginTimeout);
        case "brave":
            return createBraveEngine(config, pluginTimeout);
        case "exa":
            return createExaEngine(config, pluginTimeout);
        case "firecrawl":
            return createFirecrawlEngine(config, pluginTimeout);
        case "searxng":
            return createSearxngEngine(config, pluginTimeout);
        case "deepseek":
            return createDeepseekEngine(config, pluginTimeout);
        case "anthropic":
            return createAnthropicEngine(config, pluginTimeout, ctx);
        case "openai":
            return createOpenaiEngine(config, pluginTimeout, ctx);
        default:
            throw new Error("不支持的搜索后端");
    }
}

export function createEngines(config: EngineConfig[], pluginTimeout: number, ctx?: Context): SearchEngine[] {
    return config.map((engine) => createEngine(engine, pluginTimeout, ctx));
}
