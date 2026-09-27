import type { Context } from "koishi";
import type { FunctionContext } from "@/services/plugin/types";

import { Schema } from "koishi";
import { Plugin } from "@/services/plugin/base-plugin";
import { Metadata, Tool, withInnerThoughts } from "@/services/plugin/decorators";
import { Failed, Success } from "@/services/plugin/utils";
import { Services } from "@/shared/constants";
import { isEmpty } from "@/shared/utils";

/**
 * 网络搜索与网页抓取工具（移植自 v3-legacy search 扩展）。
 * - web_search：调用 SearXNG 聚合搜索，返回标题/链接/摘要
 * - fetch_webpage：抓取网页内容；默认静态 HTTP 抓取 + 内置提取，
 *   若安装了 koishi-plugin-puppeteer 且配置开启，则支持动态渲染页面
 */

interface SearchConfig {
    endpoint: string;
    sources: string[];
    limit: number;
    customUA: string;
    httpTimeout: number;
    usePuppeteer: boolean;
    puppeteerTimeout: number;
    puppeteerWaitTime: number;
}

// eslint-disable-next-line ts/no-redeclare
const SearchConfig: Schema<SearchConfig> = Schema.object({
    endpoint: Schema.string().default("https://searx.be").description("SearXNG 搜索实例地址"),
    sources: Schema.array(Schema.string()).default(["google", "bing", "duckduckgo"]).description("使用的搜索引擎"),
    limit: Schema.number().min(1).max(20).default(5).description("返回的搜索结果数量"),
    customUA: Schema.string().default("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36").description("请求 User-Agent"),
    httpTimeout: Schema.number().min(1000).max(60000).default(10000).description("HTTP 请求超时（毫秒）"),
    usePuppeteer: Schema.boolean().default(false).description("是否优先使用无头浏览器获取动态网页（需要安装 koishi-plugin-puppeteer）"),
    puppeteerTimeout: Schema.number().min(1000).max(120000).default(30000).description("Puppeteer 导航超时（毫秒）"),
    puppeteerWaitTime: Schema.number().min(0).max(30000).default(2000).description("Puppeteer 加载后等待时间（毫秒）"),
}).description("网络搜索");

interface PageLike {
    setUserAgent: (ua: string) => Promise<void>;
    setViewport: (view: { width: number; height: number }) => Promise<void>;
    setDefaultNavigationTimeout: (ms: number) => Promise<void>;
    goto: (url: string, opts: { waitUntil: string; timeout: number }) => Promise<{ ok: () => boolean; status: () => number; statusText: () => string } | null>;
    setContent: (html: string, opts: { waitUntil: string; timeout: number }) => Promise<void>;
    evaluate: <T>(fn: (arg: any) => T, arg: any) => Promise<T>;
    close: () => Promise<void>;
}

interface PuppeteerLike {
    page: () => Promise<PageLike>;
}

@Metadata({
    name: "search",
    display: "网络搜索",
    description: "搜索网络内容",
    builtin: true,
})
export default class SearchPlugin extends Plugin<SearchConfig> {
    static readonly inject = { required: [Services.Plugin], optional: ["puppeteer"] };
    static readonly Config = SearchConfig;

    constructor(ctx: Context, config: SearchConfig) {
        super(ctx, config);
        if (config.usePuppeteer && !(ctx as Context & { puppeteer?: PuppeteerLike }).puppeteer) {
            this.ctx.logger.warn("配置要求使用 Puppeteer，但未安装 koishi-plugin-puppeteer，动态网页将回退为静态抓取");
        }
    }

    @Tool({
        name: "web_search",
        description: "搜索网络内容，获取相关信息和链接。可以多次搜索。搜索完之后，可以访问具体链接获取详细内容",
        parameters: withInnerThoughts({
            query: Schema.string().required().description("搜索关键词或查询内容"),
        }),
    })
    async webSearch(params: { query: string }, _context: FunctionContext) {
        const { query } = params;
        if (isEmpty(query))
            return Failed("query is required");

        try {
            const searchUrl = `${this.config.endpoint.replace(/\/+$/, "")}?q=${encodeURIComponent(query)}&engines=${this.config.sources.join(",")}&format=json&limit=${this.config.limit}`;
            this.ctx.logger.info(`网络搜索: ${query}`);

            const response: any = await this.ctx.http.get(searchUrl, {
                headers: { "User-Agent": this.config.customUA },
                responseType: "json",
                timeout: this.config.httpTimeout,
            });

            const data = typeof response === "string" ? JSON.parse(response) : response;
            if (!data.results || data.results.length === 0)
                return Success(`没有找到关于"${query}"的搜索结果。`);

            const resultCount = data.number_of_results ?? data.results.length;
            let resultText = `找到 ${resultCount} 个关于"${query}"的搜索结果：\n\n`;

            const topResults = data.results.slice(0, this.config.limit);
            topResults.forEach((result: any, index: number) => {
                resultText += `${index + 1}. **${result.title || "(无标题)"}**\n`;
                resultText += `   链接: ${result.url}\n`;
                if (result.content) {
                    const cleanContent = stripTags(result.content).trim();
                    resultText += `   摘要: ${cleanContent.substring(0, 150)}${cleanContent.length > 150 ? "..." : ""}\n`;
                }
                if (result.publishedDate)
                    resultText += `   发布时间: ${result.publishedDate}\n`;
                resultText += `\n`;
            });

            if (this.puppeteer)
                resultText += `\n提示：你可以使用 <fetch_webpage> 工具获取链接的详细内容。对于动态网页，请使用 use_dynamic=true 参数。`;

            return Success(resultText);
        } catch (error: any) {
            if (error?.message?.includes("timeout"))
                return Failed("搜索请求超时");
            this.ctx.logger.error(`网络搜索失败: ${query}`, error);
            return Failed(`搜索过程中发生错误: ${error?.message ?? String(error)}`);
        }
    }

    @Tool({
        name: "fetch_webpage",
        description: `获取指定网页的内容。
  - 将网页URL添加到url参数来获取网页内容
  - 可以获取HTML内容或纯文本内容
  - 支持静态和动态网页访问
  Example:
    fetch_webpage("https://example.com", "text")`,
        parameters: withInnerThoughts({
            url: Schema.string().required().description("要获取的网页URL"),
            format: Schema.union(["html", "text"]).default("text").description("返回格式：html(原始HTML) 或 text(纯文本)"),
            max_length: Schema.number().default(5000).description("返回内容的最大长度，默认5000字符"),
            include_links: Schema.boolean().default(true).description("是否包含网页中的其他链接"),
            max_links: Schema.number().default(10).description("最多显示的链接数量，默认10个"),
            use_dynamic: Schema.boolean().default(false).description("是否强制使用无头浏览器获取动态内容（需安装 puppeteer 服务）"),
        }),
    })
    async fetchWebPage(params: {
        url: string;
        format: "html" | "text";
        max_length: number;
        include_links: boolean;
        max_links: number;
        use_dynamic: boolean;
    }, _context: FunctionContext) {
        const { url, format, max_length, include_links, max_links, use_dynamic } = params;
        if (isEmpty(url))
            return Failed("url is required");

        try {
            const urlObj = new URL(url);
            if (!["http:", "https:"].includes(urlObj.protocol))
                return Failed("只支持HTTP和HTTPS协议");
        } catch {
            return Failed("URL 格式无效");
        }

        this.ctx.logger.info(`Bot正在获取网页: ${url}`);
        try {
            const { title, content, textContent, links } = await this.fetchAndExtract(url, use_dynamic, include_links ? max_links : 0);

            let resultContent = format === "text" ? textContent : content;
            if (!resultContent)
                return Failed("无法提取网页主要内容。");
            if (resultContent.length > max_length)
                resultContent = `${resultContent.substring(0, max_length)}...(内容已截断)`;

            let result = `网页标题: ${title}\n网页URL: ${url}\n内容:\n${resultContent}`;
            if (include_links && links.length > 0) {
                result += `\n\n网页中的其他链接 (${links.length}个):\n`;
                links.forEach((link, index) => {
                    result += `${index + 1}. ${link.text || "(无标题)"}\n   ${link.url}\n`;
                });
            }

            this.ctx.logger.info(`Bot成功获取网页内容，长度: ${resultContent.length}, 链接数: ${links.length}`);
            return Success(result);
        } catch (error: any) {
            this.ctx.logger.error(`Bot获取网页失败: ${url} - ${error?.message}`);
            if (error?.name === "TimeoutError" || error?.message?.includes("timeout"))
                return Failed("请求超时，网页响应时间过长或无法加载");
            if (error?.message?.includes("net::ERR_"))
                return Failed(`网络连接失败: ${error.message}`);
            if (error?.response?.status)
                return Failed(`HTTP错误: ${error.response.status} ${error.response.statusText}`);
            return Failed(`获取网页失败: ${error?.message ?? String(error)}`);
        }
    }

    private get puppeteer(): PuppeteerLike | undefined {
        return (this.ctx as Context & { puppeteer?: PuppeteerLike }).puppeteer;
    }

    private async fetchAndExtract(url: string, useDynamic: boolean, maxLinks: number) {
        const usePuppeteer = useDynamic || this.config.usePuppeteer;
        if (usePuppeteer && this.puppeteer) {
            return this.fetchWithPuppeteer(url, maxLinks);
        }
        if (usePuppeteer) {
            this.ctx.logger.warn("请求动态渲染，但 Puppeteer 服务不可用，回退为静态抓取");
        }

        // 静态抓取：HTTP 获取原始 HTML，本地提取
        const html = await this.ctx.http.get<string>(url, {
            headers: { "User-Agent": this.config.customUA },
            timeout: this.config.httpTimeout,
            responseType: "text",
        });
        return extractFromHtml(html, maxLinks);
    }

    private async fetchWithPuppeteer(url: string, maxLinks: number) {
        const page = await this.puppeteer!.page();
        try {
            await page.setUserAgent(this.config.customUA);
            await page.setViewport({ width: 1280, height: 800 });
            await page.setDefaultNavigationTimeout(this.config.puppeteerTimeout);

            const response = await page.goto(url, {
                waitUntil: "networkidle2",
                timeout: this.config.puppeteerTimeout,
            });
            if (!response || !response.ok())
                throw new Error(`页面加载失败: ${response?.status()} ${response?.statusText()}`);
            if (this.config.puppeteerWaitTime > 0)
                await new Promise((resolve) => setTimeout(resolve, this.config.puppeteerWaitTime));

            return await page.evaluate((maxLinksArg) => {
                const contentSelectors = [
                    "article",
                    "main",
                    ".main-content",
                    ".post-content",
                    ".entry-content",
                    "#article",
                    "#content",
                    "#main",
                    "#root",
                    ".content",
                    ".post",
                    ".story",
                ];
                let mainElement: HTMLElement | null = null;
                for (const selector of contentSelectors) {
                    mainElement = document.querySelector(selector);
                    if (mainElement)
                        break;
                }
                if (!mainElement)
                    mainElement = document.body;
                mainElement.querySelectorAll("script, style, noscript, iframe, footer, header, nav").forEach((el) => el.remove());

                const content = mainElement.innerHTML;
                const textContent = mainElement.textContent?.replace(/\s{2,}/g, "\n").trim() || "";

                const links: Array<{ url: string; text: string }> = [];
                if (maxLinksArg > 0) {
                    for (const a of Array.from(document.querySelectorAll("a"))) {
                        if (links.length >= maxLinksArg)
                            break;
                        const href = a.href;
                        if (href && href.startsWith("http") && !links.some((l) => l.url === href)) {
                            links.push({ url: href, text: a.textContent?.trim() || "" });
                        }
                    }
                }
                return { title: document.title || "未找到标题", content, textContent, links };
            }, maxLinks);
        } finally {
            await page.close().catch((e) => this.ctx.logger.warn(`关闭Puppeteer页面时出错: ${e.message}`));
        }
    }
}

/** 无浏览器环境下从原始 HTML 提取标题/正文/链接 */
function extractFromHtml(html: string, maxLinks: number): { title: string; content: string; textContent: string; links: Array<{ url: string; text: string }> } {
    // 移除脚本/样式等噪音块
    const cleaned = html.replace(/<(script|style|noscript|iframe|footer|header|nav)[^>]*>[\s\S]*?<\/\1>/gi, " ");

    const titleMatch = cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripTags(titleMatch[1]).trim() || "未找到标题" : "未找到标题";

    // 正文优先取 article/main 等容器，回退到 body
    const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i) ?? cleaned.match(/<html[^>]*>([\s\S]*?)<\/html>/i);
    const body = bodyMatch ? bodyMatch[1] : cleaned;
    const container = body.match(/<(article|main)[^>]*>[\s\S]*?<\/\1>/i)?.[0] ?? body;
    const content = container.trim();

    // 纯文本：去标签 + 归一化空白
    const textContent = stripTags(content).replace(/\s{2,}/g, "\n").trim();

    // 链接
    const links: Array<{ url: string; text: string }> = [];
    if (maxLinks > 0) {
        const anchorRe = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match = anchorRe.exec(body);
        while (match && links.length < maxLinks) {
            const url = match[1];
            const text = stripTags(match[2]).trim();
            if (!links.some((l) => l.url === url))
                links.push({ url, text });
            match = anchorRe.exec(body);
        }
    }

    return { title, content, textContent, links };
}

function stripTags(input: string): string {
    return input
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/g, "'");
}
