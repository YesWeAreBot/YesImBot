import { isEmpty } from "@/shared";
import { Context, Schema } from "koishi";
import { Extension, Tool } from "../../decorators";
import { Failed, Success } from "../../helpers";
import { Infer } from "../../types";

interface SearchConfig {
    endpoint: string;
    limit: number;
    sources: string[];
    format: "json" | "html";
}

const SearchConfigSchema: Schema<SearchConfig> = Schema.object({
    endpoint: Schema.string().default("https://search.yesimbot.chat/search").role("link").description("搜索服务的 API Endpoint"),
    limit: Schema.number().default(5).description("默认搜索结果数量"),
    sources: Schema.array(Schema.string()).default(["baidu", "github", "bing", "presearch"]).role("table").description("默认搜索源"),
    format: Schema.union(["json", "html"]).default("json").description("默认搜索结果格式"),
});

@Extension({
    name: "search",
    display: "网络搜索",
    version: "1.0.0",
    description: "搜索网络内容",
    author: "HydroGest",
})
export default class SearchExtension {
    public static readonly Config = SearchConfigSchema;

    constructor(public ctx: Context, public config: SearchConfig) {}

    @Tool({
        name: "fetch_webpage",
        description: `获取指定网页的内容。
  - 将网页URL添加到url参数来获取网页内容
  - 可以获取HTML内容或纯文本内容
  - 支持基本的HTTP/HTTPS网页访问
  - 自动提取网页中的其他链接
  Example:
    fetch_webpage("https://example.com", "text")`,
        parameters: Schema.object({
            inner_thoughts: Schema.string().description("执行此操作前的内心思考过程，用于自我反思和记录。"),
            url: Schema.string().required().description("要获取的网页URL"),
            format: Schema.union(["html", "text"]).default("text").description("返回格式：html(原始HTML) 或 text(纯文本)"),
            max_length: Schema.number().default(5000).description("返回内容的最大长度，默认5000字符"),
            include_links: Schema.boolean().default(true).description("是否包含网页中的其他链接"),
            max_links: Schema.number().default(10).description("最多显示的链接数量，默认10个"),
        }),
    })
    async fetchWebPage(
        args: Infer<{
            url: string;
            format: "html" | "text";
            max_length: number;
            include_links: boolean;
            max_links: number;
        }>
    ) {
        const { url, format, max_length, include_links, max_links } = args;
        if (isEmpty(url)) return Failed("url is required");

        try {
            // 验证URL格式
            const urlObj = new URL(url);
            if (!["http:", "https:"].includes(urlObj.protocol)) {
                return Failed("只支持HTTP和HTTPS协议");
            }

            this.ctx.logger.info(`Bot正在获取网页: ${url}`);

            const response = await fetch(url, {
                headers: {
                    "User-Agent": "YesImBot/1.0.0 (Web Fetcher Tool)",
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                },
                signal: AbortSignal.timeout(10000),
            });

            if (!response.ok) {
                return Failed(`HTTP错误: ${response.status} ${response.statusText}`);
            }

            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
                return Failed("不支持的内容类型，仅支持HTML和纯文本");
            }

            // 只读取一次 response body
            const rawContent = await response.text();
            const title = extractTitle(rawContent);

            // 提取链接
            const links = include_links ? extractLinks(rawContent, url, max_links) : [];

            let content = rawContent;

            // 如果请求纯文本格式，提取HTML中的文本内容
            if (format === "text") {
                content = content
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                    .replace(/<[^>]+>/g, "")
                    .replace(/&nbsp;/g, " ")
                    .replace(/&lt;/g, "<")
                    .replace(/&gt;/g, ">")
                    .replace(/&amp;/g, "&")
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/\s+/g, " ")
                    .trim();
            }

            // 限制返回内容长度
            if (content.length > max_length) {
                content = content.substring(0, max_length) + "...(内容已截断)";
            }

            // 构建返回结果
            let result = `网页标题: ${title}\n网页URL: ${url}\n内容:\n${content}`;

            // 添加链接信息
            if (include_links && links.length > 0) {
                result += `\n\n网页中的其他链接 (${links.length}个):\n`;
                links.forEach((link, index) => {
                    result += `${index + 1}. ${link.text || "(无标题)"}\n   ${link.url}\n`;
                });
            }

            this.ctx.logger.info(`Bot成功获取网页内容，长度: ${content.length}, 链接数: ${links.length}`);

            return Success(result);
        } catch (error) {
            this.ctx.logger.error(`Bot获取网页失败: ${url} - `, error.message);

            if (error.name === "TimeoutError") {
                return Failed("请求超时，网页响应时间过长");
            } else if (error.name === "TypeError" && error.message.includes("fetch")) {
                return Failed("网络连接失败，请检查URL是否正确");
            } else {
                return Failed(`获取网页失败: ${error.message}`);
            }
        }
    }

    @Tool({
        name: "web_search",
        description: "搜索网络内容，获取相关信息和链接。可以多次搜索。在你搜索完之后，可以先访问具体内容",
        parameters: Schema.object({
            inner_thoughts: Schema.string().description("执行此操作前的内心思考过程，用于自我反思和记录。"),
            query: Schema.string().required().description("搜索关键词或查询内容。"),
        }),
    })
    async webSearch(args: Infer<{ query: string }>) {
        const { query } = args;

        if (isEmpty(query)) return Failed("query is required");

        try {
            const endpoint = this.config.endpoint;
            const engines = this.config.sources;
            const format = this.config.format;
            const limit = this.config.limit;
            const searchUrl = `${endpoint}?q=${encodeURIComponent(query)}&engines=${engines.join(",")}&format=${format}`;

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
            const topResults = data.results.slice(0, limit);
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
            this.ctx.logger.error(`网络搜索失败: ${error.message}`);
            return Failed(`搜索过程中发生错误: ${error.message}`);
        }
    }
}

// 辅助函数：提取网页标题
function extractTitle(html: string): string {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
        return titleMatch[1].trim().replace(/\s+/g, " ");
    }
    return "未找到标题";
}

// 辅助函数：提取网页中的链接
function extractLinks(html: string, baseUrl: string, maxLinks: number = 10): Array<{ url: string; text: string }> {
    const links: Array<{ url: string; text: string }> = [];
    const linkRegex = /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const baseUrlObj = new URL(baseUrl);

    let match;
    while ((match = linkRegex.exec(html)) !== null && links.length < maxLinks) {
        try {
            let linkUrl = match[1].trim();
            let linkText = match[2]
                .replace(/<[^>]+>/g, "") // 移除HTML标签
                .replace(/\s+/g, " ") // 合并空白字符
                .trim();

            // 处理相对链接
            if (linkUrl.startsWith("//")) {
                linkUrl = baseUrlObj.protocol + linkUrl;
            } else if (linkUrl.startsWith("/")) {
                linkUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${linkUrl}`;
            } else if (!linkUrl.startsWith("http")) {
                // 跳过非HTTP链接（如 mailto:, javascript: 等）
                if (linkUrl.includes(":") && !linkUrl.startsWith("http")) {
                    continue;
                }
                // 相对路径
                linkUrl = new URL(linkUrl, baseUrl).href;
            }

            // 验证是否为有效的HTTP/HTTPS链接
            const urlObj = new URL(linkUrl);
            if (!["http:", "https:"].includes(urlObj.protocol)) {
                continue;
            }

            // 避免重复链接
            if (!links.some((link) => link.url === linkUrl)) {
                links.push({
                    url: linkUrl,
                    text: linkText || "(无标题)",
                });
            }
        } catch (error) {
            // 忽略无效的URL
            continue;
        }
    }

    return links;
}
