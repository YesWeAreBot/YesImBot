import { Extension, Tool, withInnerThoughts } from "@/services/extension/decorators";
import { Failed, Success } from "@/services/extension/helpers";
import { WithSession } from "@/services/extension/types";
import { isEmpty } from "@/shared";
import { Context, Schema } from "koishi";
import {} from "koishi-plugin-puppeteer";

interface SearchConfig {
    endpoint: string;
    limit: number;
    sources: string[];
    format: "json" | "html";
    customUA: string;
    usePuppeteer: boolean; // 是否使用无头浏览器
    httpTimeout: number; // HTTP请求超时时间（毫秒）
    puppeteerTimeout: number; // Puppeteer超时时间（毫秒）
    puppeteerWaitTime: number; // Puppeteer加载后等待时间（毫秒）
}

const SearchConfigSchema: Schema<SearchConfig> = Schema.object({
    endpoint: Schema.string().default("https://search.yesimbot.chat/search").role("link").description("搜索服务的 API Endpoint"),
    limit: Schema.number().default(5).description("默认搜索结果数量"),
    sources: Schema.array(Schema.string()).default(["baidu", "github", "bing", "presearch"]).role("table").description("默认搜索源"),
    format: Schema.union(["json", "html"]).default("json").description("默认搜索结果格式"),
    customUA: Schema.string().default("YesImBot/1.0.0 (Web Fetcher Tool)").description("自定义User-Agent字符串，用于网页请求"),
    usePuppeteer: Schema.boolean().default(false).description("是否使用无头浏览器获取动态网页(需要安装puppeteer服务)"),
    httpTimeout: Schema.number().default(10000).description("HTTP请求超时时间(毫秒)"),
    puppeteerTimeout: Schema.number().default(30000).description("Puppeteer无头浏览器超时时间(毫秒)"),
    puppeteerWaitTime: Schema.number().default(2000).description("Puppeteer加载后等待时间(毫秒)"),
});

@Extension({
    name: "search",
    display: "网络搜索",
    version: "极速版",
    description: "搜索网络内容",
    author: "HydroGest",
    builtin: true,
})
export default class SearchExtension {
    public static readonly Config = SearchConfigSchema;
    static readonly inject = {
        required: ["http"],
        optional: ["puppeteer"],
    };

    constructor(
        public ctx: Context,
        public config: SearchConfig
    ) {
        // 检查Puppeteer服务是否可用
        if (config.usePuppeteer && !ctx.puppeteer) {
            ctx.logger.warn("配置要求使用Puppeteer，但Puppeteer服务未安装。请安装puppeteer插件。");
        }
    }

    @Tool({
        name: "fetch_webpage",
        description: `获取指定网页的内容。支持动态渲染页面。
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
            use_dynamic: Schema.boolean().default(false).description("是否强制使用无头浏览器获取动态内容"),
        }),
        isSupported: (session) => {
            const ctx = session.app;
            return !!ctx.puppeteer;
        },
    })
    async fetchWebPage(
        args: WithSession<{
            url: string;
            format: "html" | "text";
            max_length: number;
            include_links: boolean;
            max_links: number;
            use_dynamic: boolean;
        }>
    ) {
        const { url, format, max_length, include_links, max_links, use_dynamic } = args;
        if (isEmpty(url)) return Failed("url is required");
        if (!this.ctx.puppeteer) {
            return Failed("Puppeteer服务未安装或不可用，无法获取网页内容。");
        }

        try {
            // 验证URL格式
            const urlObj = new URL(url);
            if (!["http:", "https:"].includes(urlObj.protocol)) {
                return Failed("只支持HTTP和HTTPS协议");
            }

            this.ctx.logger.info(`Bot正在获取网页: ${url}`);

            // 决定是否使用动态加载模式
            const useDynamicLoading = use_dynamic || this.config.usePuppeteer;

            // 使用统一的Puppeteer方法获取和解析内容
            const { title, content, textContent, links } = await this._fetchAndExtractWithPuppeteer(
                url,
                useDynamicLoading,
                include_links ? max_links : 0
            );

            let resultContent = format === "text" ? textContent : content;
            if (!resultContent) {
                return Failed("无法提取网页主要内容。");
            }

            // 限制返回内容长度
            if (resultContent.length > max_length) {
                resultContent = resultContent.substring(0, max_length) + "...(内容已截断)";
            }

            // 构建返回结果
            let result = `网页标题: ${title}\n网页URL: ${url}\n内容:\n${resultContent}`;

            // 添加链接信息
            if (include_links && links.length > 0) {
                result += `\n\n网页中的其他链接 (${links.length}个):\n`;
                links.forEach((link, index) => {
                    result += `${index + 1}. ${link.text || "(无标题)"}\n   ${link.url}\n`;
                });
            }

            this.ctx.logger.info(`Bot成功获取网页内容，长度: ${resultContent.length}, 链接数: ${links.length}`);
            return Success(result);
        } catch (error: any) {
            this.ctx.logger.error(`Bot获取网页失败: ${url} - `, error.message);
            if (error.name === "TimeoutError" || error.message.includes("timeout")) {
                return Failed("请求超时，网页响应时间过长或无法加载");
            } else if (error.message.includes("net::ERR_")) {
                return Failed(`网络连接失败: ${error.message}`);
            } else if (error.response?.status) {
                return Failed(`HTTP错误: ${error.response.status} ${error.response.statusText}`);
            } else {
                return Failed(`获取网页失败: ${error.message}`);
            }
        }
    }

    /**
     * 使用 Puppeteer 获取并提取网页内容
     * @param url 要获取的网页URL
     * @param isDynamic 是否使用动态加载模式 (page.goto) 或静态加载模式 (http.get + page.setContent)
     * @param maxLinks 要提取的最大链接数，为0则不提取
     * @returns 包含标题、HTML内容、纯文本和链接的对象
     */
    private async _fetchAndExtractWithPuppeteer(url: string, isDynamic: boolean, maxLinks: number) {
        if (!this.ctx.puppeteer) {
            throw new Error("Puppeteer服务不可用");
        }

        const page = await this.ctx.puppeteer.page();
        try {
            await page.setUserAgent(this.config.customUA);
            await page.setViewport({ width: 1280, height: 800 });
            await page.setDefaultNavigationTimeout(this.config.puppeteerTimeout);

            if (isDynamic) {
                this.ctx.logger.info(`使用动态模式加载: ${url}`);
                const response = await page.goto(url, {
                    waitUntil: "networkidle2",
                    timeout: this.config.puppeteerTimeout,
                });
                if (!response || !response.ok()) {
                    throw new Error(`页面加载失败: ${response?.status()} ${response?.statusText()}`);
                }
                if (this.config.puppeteerWaitTime > 0) {
                    await new Promise((resolve) => setTimeout(resolve, this.config.puppeteerWaitTime));
                }
            } else {
                this.ctx.logger.info(`使用静态模式加载: ${url}`);
                const html = await this.ctx.http.get(url, {
                    headers: { "User-Agent": this.config.customUA },
                    timeout: this.config.httpTimeout,
                    responseType: "text",
                });
                // 使用 setContent 将静态HTML加载到Puppeteer中进行解析
                await page.setContent(html, {
                    waitUntil: "domcontentloaded",
                    timeout: this.config.puppeteerTimeout,
                });
            }

            // 在浏览器上下文中执行所有提取操作
            const extractedData = await page.evaluate((maxLinks) => {
                // 1. 提取主要内容 (替代 Readability 和 Cheerio)
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
                    if (mainElement) break;
                }
                // 回退到 body
                if (!mainElement) {
                    mainElement = document.body;
                }

                // 移除脚本和样式，净化内容
                mainElement.querySelectorAll("script, style, noscript, iframe, footer, header, nav").forEach((el) => el.remove());

                const content = mainElement.innerHTML;
                // 使用 innerText 获取格式化的纯文本，比正则替换更可靠
                const textContent = mainElement.innerText.replace(/\s{2,}/g, "\n").trim();

                // 2. 提取链接
                let links: Array<{ url: string; text: string }> = [];
                if (maxLinks > 0) {
                    const anchorElements = Array.from(document.querySelectorAll("a"));
                    for (const a of anchorElements) {
                        if (links.length >= maxLinks) break;
                        const href = a.href;
                        // 过滤无效或非HTTP链接
                        if (href && href.startsWith("http") && !links.some((l) => l.url === href)) {
                            links.push({
                                url: href,
                                text: a.textContent?.trim() || "",
                            });
                        }
                    }
                }

                // 3. 提取标题
                const title = document.title || "未找到标题";

                return { title, content, textContent, links };
            }, maxLinks); // 将 maxLinks 传递给 evaluate 函数

            return extractedData;
        } finally {
            await page.close().catch((e) => this.ctx.logger.warn(`关闭Puppeteer页面时出错: ${e.message}`));
        }
    }

    @Tool({
        name: "web_search",
        description: "搜索网络内容，获取相关信息和链接。可以多次搜索。在你搜索完之后，可以先访问具体内容",
        parameters: withInnerThoughts({
            query: Schema.string().required().description("搜索关键词或查询内容。"),
        }),
    })
    async webSearch(args: WithSession<{ query: string }>) {
        const { query } = args;

        if (isEmpty(query)) return Failed("query is required");

        try {
            const endpoint = this.config.endpoint;
            const engines = this.config.sources.join(",");
            const format = this.config.format;
            const limit = this.config.limit;
            const searchUrl = `${endpoint}?q=${encodeURIComponent(query)}&engines=${engines}&format=${format}&limit=${limit}`;

            this.ctx.logger.info(`正在搜索: ${query}, 使用URL: ${searchUrl}`);

            // 使用 Koishi 的 HTTP 服务发送请求
            const response: any = await this.ctx.http.get(searchUrl, {
                headers: {
                    "User-Agent": this.config.customUA,
                },
                responseType: "json",
                timeout: this.config.httpTimeout,
            });

            // 处理响应
            const data = typeof response === "string" ? JSON.parse(response) : response;

            // 格式化搜索结果
            if (!data.results || data.results.length === 0) {
                return Success(`没有找到关于"${query}"的搜索结果。`);
            }

            const resultCount = data.number_of_results ?? data.results.length;
            let resultText = `找到 ${resultCount} 个关于"${query}"的搜索结果：\n\n`;

            // 显示前N个结果
            const topResults = data.results.slice(0, limit);
            topResults.forEach((result: any, index: number) => {
                resultText += `${index + 1}. **${result.title || "(无标题)"}**\n`;
                resultText += `   链接: ${result.url}\n`;

                if (result.content) {
                    // 移除摘要中的HTML标签
                    const cleanContent = result.content.replace(/<\/?[^>]+(>|$)/g, "");
                    resultText += `   摘要: ${cleanContent.substring(0, 150)}${cleanContent.length > 150 ? "..." : ""}\n`;
                }

                if (result.publishedDate) {
                    resultText += `   发布时间: ${result.publishedDate}\n`;
                }

                resultText += `\n`;
            });

            this.ctx.logger.info(`返回搜索结果: ${topResults.length}项`);

            // 如果启用了Puppeteer，添加提示信息
            if (this.ctx.puppeteer) {
                resultText += `\n提示：你可以使用 <fetch_webpage> 工具获取链接的详细内容。对于动态网页，请使用 use_dynamic=true 参数。`;
            }

            return Success(resultText);
        } catch (error: any) {
            if (error.message.includes("timeout")) {
                return Failed("搜索请求超时", { retryable: true });
            }
            this.ctx.logger.error(`网络搜索失败: `, error);
            return Failed(`搜索过程中发生错误: ${error.message}`);
        }
    }
}
