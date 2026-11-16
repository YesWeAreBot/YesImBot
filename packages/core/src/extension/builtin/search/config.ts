import { Schema } from "koishi";

import type { EngineConfig, SearchConfig } from "./types.js";

const EngineBase = Schema.object({
    id: Schema.string().required().description("引擎名称，同一份插件配置内必须唯一"),
    backend: Schema.union([
        Schema.const("tavily").description("Tavily"),
        Schema.const("brave").description("Brave Search"),
        Schema.const("exa").description("Exa"),
        Schema.const("firecrawl").description("Firecrawl"),
        Schema.const("searxng").description("SearXNG"),
        Schema.const("deepseek").description("DeepSeek"),
        Schema.const("anthropic").description("Anthropic"),
        Schema.const("openai").description("OpenAI"),
    ])
        .default("tavily")
        .description("搜索后端类型"),
    timeoutMs: Schema.number().min(0).default(0).description("单次请求超时（毫秒）；0 表示使用插件级 timeoutMs"),
});

export const EngineConfigSchema: Schema<EngineConfig> = Schema.intersect([
    EngineBase,
    Schema.union([
        Schema.object({
            backend: Schema.const("tavily"),
            apiKey: Schema.string().role("secret").required().description("Tavily API Key"),
            endpoint: Schema.string().role("link").default("https://api.tavily.com").description("API 根地址"),
            searchDepth: Schema.union(["basic", "advanced", "fast", "ultra-fast"]).default("basic").description("Tavily 检索深度"),
            includeAnswer: Schema.boolean().default(false).description("让 Tavily 同时返回一段综合答案"),
        }),
        Schema.object({
            backend: Schema.const("brave").required(),
            apiKey: Schema.string().role("secret").required().description("Brave Search API Key"),
            endpoint: Schema.string().role("link").default("https://api.search.brave.com/res/v1").description("API 根地址"),
            country: Schema.string().default("").description("国家代码，如 CN、US；留空由 Brave 决定"),
            searchLang: Schema.string().default("").description("结果语言，如 zh-hans、en；留空由 Brave 决定"),
            safesearch: Schema.union(["off", "moderate", "strict"]).default("moderate").description("安全搜索级别"),
            extraSnippets: Schema.boolean().default(false).description("请求额外的摘要片段"),
        }),
        Schema.object({
            backend: Schema.const("exa").required(),
            apiKey: Schema.string().role("secret").required().description("Exa API Key"),
            endpoint: Schema.string().role("link").default("https://api.exa.ai").description("API 根地址"),
            type: Schema.union(["auto", "fast", "instant", "deep-lite", "deep"]).default("auto").description("Exa 检索类型"),
        }),
        Schema.object({
            backend: Schema.const("firecrawl").required(),
            apiKey: Schema.string().role("secret").required().description("Firecrawl API Key"),
            endpoint: Schema.string().role("link").default("https://api.firecrawl.dev/v2").description("API 根地址，包含版本段"),
        }),
        Schema.object({
            backend: Schema.const("searxng").required(),
            endpoint: Schema.string().role("link").required().description("SearXNG 实例根地址，如 https://searx.be"),
            apiKey: Schema.string().role("secret").default("").description("实例要求认证时填写；通常留空"),
            categories: Schema.array(Schema.string()).default(["general"]).description("检索分类"),
            language: Schema.string().default("all").description("结果语言，如 zh-CN、en；all 表示不限"),
            safesearch: Schema.union([0, 1, 2]).default(1).description("安全搜索级别：0 关闭，1 适中，2 严格"),
        }),
        Schema.object({
            backend: Schema.const("deepseek").required(),
            apiKey: Schema.string().role("secret").required().description("DeepSeek API Key"),
            endpoint: Schema.string().role("link").default("https://api.deepseek.com").description("API 根地址"),
            needContent: Schema.boolean().default(false).description("同时返回页面正文；会增加响应体积"),
        }),
        Schema.object({
            backend: Schema.const("anthropic").required(),
            apiKey: Schema.string().role("secret").required().description("Anthropic API Key"),
            endpoint: Schema.string().role("link").default("https://api.anthropic.com/v1").description("API 根地址，包含版本段"),
            model: Schema.string().default("claude-sonnet-4-6").description("支持 web_search_20260318 / web_fetch_20260318 的模型"),
            maxUses: Schema.number().min(1).default(3).description("单次请求最多搜索次数"),
            maxTokens: Schema.number().min(256).default(2048).description("综合答案的输出 token 上限"),
            maxContentTokens: Schema.number().min(1000).default(50000).description("抓取工具单页正文的 token 上限"),
            allowedDomains: Schema.array(Schema.string()).default([]).description("只允许这些域名；与 blockedDomains 不能同时填写"),
            blockedDomains: Schema.array(Schema.string()).default([]).description("排除这些域名；与 allowedDomains 不能同时填写"),
        }),
        Schema.object({
            backend: Schema.const("openai").required(),
            apiKey: Schema.string().role("secret").required().description("OpenAI API Key"),
            endpoint: Schema.string().role("link").default("https://api.openai.com/v1").description("Responses API 根地址"),
            model: Schema.string().default("gpt-5").description("支持 web_search 工具的模型"),
            searchContextSize: Schema.union(["low", "medium", "high"]).default("medium").description("搜索上下文规模"),
            maxOutputTokens: Schema.number().min(256).default(2048).description("综合答案的输出 token 上限"),
            allowedDomains: Schema.array(Schema.string()).default([]).description("只允许这些域名"),
            blockedDomains: Schema.array(Schema.string()).default([]).description("排除这些域名"),
        }),
    ]),
]) as unknown as Schema<EngineConfig>;

export interface ManagedSearchConfig {
    engineSelection: "legacy" | "configured";
    selectedEngines: string[];
    strategy: "auto" | "parallel";
    engines: EngineConfig[];
    engineOptions: SearchConfig;
}

export const managedSearchFields = {
    engineSelection: Schema.union([Schema.const("legacy").description("原搜索端点"), Schema.const("configured").description("勾选引擎")])
        .role("radio")
        .default("legacy")
        .description("联网搜索来源"),
    selectedEngines: Schema.array(Schema.string()).default([]).description("启用的引擎（未勾选时停用搜索）"),
    strategy: Schema.union([Schema.const("auto").description("按引擎配置顺序尝试"), Schema.const("parallel").description("并行搜索并去重")])
        .role("radio")
        .default("auto")
        .description("运行方式"),
    engines: Schema.array(EngineConfigSchema).default([]).description("引擎配置"),
    engineOptions: Schema.object({
        maxLimit: Schema.natural().min(1).max(50).default(20).description("搜索结果数上限"),
        timeoutMs: Schema.natural().min(100).max(120000).default(10000).description("单引擎默认超时（毫秒）"),
        totalTimeoutMs: Schema.natural().min(100).max(180000).default(30000).description("单次搜索或抓取的总超时（毫秒）"),
        maxFetchUrls: Schema.natural().min(1).max(10).default(5).description("一次最多抓取的页面数"),
        maxContentChars: Schema.natural().min(100).max(100000).default(20000).description("单页正文字符上限"),
        maxSnippetChars: Schema.natural().min(50).max(10000).default(1000).description("单条摘要字符上限"),
        maxAnswerChars: Schema.natural().min(100).max(100000).default(8000).description("综合答案字符上限"),
        blacklist: Schema.array(Schema.string()).default([]).description("过滤搜索及抓取 URL 的正则列表"),
    })
        .collapse()
        .description("引擎超时和结果限制"),
};
