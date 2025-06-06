import { z } from "zod";
import { createTool, Failed, Success, withCommonParams } from "../helpers";

export const WebSearch = createTool({
    name: "web_search",
    version: "1.0.0",
    description: "搜索网络内容，获取相关信息和链接。可以多次搜索。在你搜索完之后，可以先访问具体内容",
    author: "HydroGest",

    parameters: withCommonParams({
        query: z.string().describe("搜索关键词或查询内容。"),
    }),

    hooks: {
        onBeforeExecute: async (params, context) => {
            const { koishiContext } = context;
            koishiContext?.logger.debug(`[WebSearchTool] 准备执行指令: ${params.cmd}`);
        },

        onAfterExecute: async (result, context) => {
            const { koishiContext } = context;
            if (result.success) {
                koishiContext?.logger.debug(`[WebSearchTool] 指令执行成功`);
            } else {
                koishiContext?.logger.debug(`[WebSearchTool] 指令执行失败: ${result.error}`);
            }
        },

        onError: async (error, context) => {
            const { koishiContext } = context;
            koishiContext?.logger.error(`[WebSearchTool] 执行过程中发生错误:`, error);
        },
    },

    execute: async ({ query }, context) => {
        try {
            const searchUrl = `https://search.yesimbot.chat/search?q=${encodeURIComponent(query)}&engines=baidu,github,bing,presearch&format=json`;

            const response = await fetch(searchUrl);
            if (!response.ok) {
                return Failed(`搜索请求失败: HTTP ${response.status}`);
            }

            const data = await response.json();

            // 格式化搜索结果
            if (data.results.length === 0) {
                return Success(`没有找到关于"${query}"的搜索结果。`);
            }

            let resultText = `找到 ${data.number_of_results} 个关于"${query}"的搜索结果：\n\n`;

            // 显示前5个结果
            const topResults = data.results.slice(0, 5);
            topResults.forEach((result, index) => {
                resultText += `${index + 1}. **${result.title}**\n`;
                resultText += `   链接: ${result.url}\n`;
                resultText += `   摘要: ${result.content.substring(0, 150)}...\n`;
                if (result.publishedDate) {
                    resultText += `   发布时间: ${result.publishedDate}\n`;
                }
                resultText += `\n`;
            });

            return Success(resultText);
        } catch (error) {
            context.koishiContext.logger.error(`网络搜索失败: ${error.message}`);
            return Failed(`搜索过程中发生错误: ${error.message}`);
        }
    },
});
