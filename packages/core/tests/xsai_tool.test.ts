///<reference types="bun-types" />

import { env } from "process";
import { OpenAIAdapter } from "../src/adapters";

import { LLMConfig } from "../src/adapters/config";
import { Config } from "../src/config";
import { defineTool, LLMContext } from "../src/extensions/base";
import { z } from "zod";

const adapterConfig: LLMConfig = {
    APIKey: env.OPENAI_API_KEY || "",
    APIType: "OpenAI",
    AIModel: "deepseek-chat",
    BaseURL: "https://api.deepseek.com",

    Ability: ["原生工具调用", "流式输出"]
}

const parameters: Config["Parameters"] = {

}

const context: LLMContext = {

}

const adapter = new OpenAIAdapter(adapterConfig);

const calc = defineTool({
    name: "calc",
    description: "计算两个数的和",
    parameters: z.object({
        a: z.number().describe("第一个数"),
        b: z.number().describe("第二个数")
    }),
    execute: async ({ a, b }) => {
        console.log(`Tool called with a: ${a}, b: ${b}`)
        return a + b;
    },
    returns: z.number().describe("计算结果")
});

const weather = defineTool({
    name: "weather",
    description: "获取指定城市的天气",
    parameters: z.object({
        city: z.string().describe("城市名称")
    }),
    execute: async ({ city }) => {
        console.log(`Tool called with city: ${city}`)
        return `今天${city}的天气是晴`;
    },
    returns: z.string().describe("天气信息")
});

const news = defineTool({
    name: "news",
    description: "获取指定日期的新闻",
    parameters: z.object({
        date: z.string().describe("日期 YYYY-MM-DD")
    }),
    execute: async ({ date }) => {
        console.log(`Tool called with date: ${date}`)
        return `今天${date} 是愚人节`;
    },
    returns: z.string().describe("新闻信息")
})

const search = defineTool({
    name: "search",
    description: "搜索指定内容",
    parameters: z.object({
        query: z.string().describe("搜索内容")
    }),
    execute: async ({ query }) => {
        console.log(`Tool called with query: ${query}`)
        return `Search endpoint not implemented`;
    },
    returns: z.string().describe("搜索结果")
});

const toolList = await Promise.all([calc, weather, search, news].map(async tool => await tool(context)))

const { text } = await adapter.chat([{ role: "user", content: "今天有什么特殊的事吗" }], toolList, true)

console.log(text)
