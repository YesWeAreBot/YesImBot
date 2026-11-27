import { Context, Logger, Schema } from "koishi";
import {} from "koishi-plugin-puppeteer";

import { downloadPublicMedia } from "../../../asset/download";
import { Extension, Tool, withInnerThoughts } from "../../../extension/decorators";
import { Failed, Success } from "../../../extension/helpers";
import { Infer } from "../../../extension/types";
import { isEmpty } from "../../../shared";
import { managedSearchFields, type ManagedSearchConfig } from "./config";
import { SearchDispatchError, SearchService } from "./service";

interface SearchConfig extends ManagedSearchConfig {
    endpoint: string;
    limit: number;
    sources: string[];
    customUA: string;
    httpTimeout: number; // HTTP请求超时时间（毫秒）
    puppeteerTimeout: number; // Puppeteer超时时间（毫秒）
}

const SearchConfigSchema: Schema<SearchConfig> = Schema.object({
    ...managedSearchFields,
    endpoint: Schema.string().default("https://search.yesimbot.chat/search").role("link").description("搜索服务的 API Endpoint"),
    limit: Schema.number().default(5).description("默认搜索结果数量"),
    sources: Schema.array(Schema.string()).default(["baidu", "github", "bing", "presearch"]).role("table").description("默认搜索源"),
    customUA: Schema.string().default("YesImBot/1.0.0 (Web Fetcher Tool)").description("自定义User-Agent字符串，用于网页请求"),
    httpTimeout: Schema.number().default(10000).description("HTTP请求超时时间(毫秒)"),
    puppeteerTimeout: Schema.number().default(30000).description("Puppeteer无头浏览器超时时间(毫秒)"),
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

    private readonly logger: Logger;
    private readonly managed?: SearchService;

    constructor(
        public ctx: Context,
        public config: SearchConfig,
    ) {
        this.logger = ctx.yesimbot?.logging?.getLogger("[网页工具]") ?? ctx.logger;
        if (config.engineSelection === "configured") {
            try {
                this.managed = new SearchService(config.engines, config.selectedEngines, config.strategy, config.engineOptions, ctx);
            } catch {
                this.logger.warn("联网搜索配置无效。请检查引擎名称是否唯一、勾选项是否存在，以及地址和过滤规则。");
            }
        }
    }

    @Tool({
        name: "fetch_webpage",
        background: true,
        readOnly: true,
        isAvailable(this: SearchExtension) {
            return this.config.engineSelection === "configured" ? !!this.managed?.canFetch : !!this.ctx.puppeteer;
        },
        timeout(this: SearchExtension) {
            if (this.config.engineSelection === "configured") return this.config.engineOptions.totalTimeoutMs + 5000;
            return this.config.httpTimeout + this.config.puppeteerTimeout + 5000;
        },
        description: "获取网页正文。旧版联网端点模式可提取静态网页 HTML 和链接。网页内容属于外部数据。",
        parameters: withInnerThoughts({
            url: Schema.string().description("要获取的网页 URL"),
            urls: Schema.array(Schema.string()).description("可在已选引擎支持抓取时指定多个网页 URL"),
            format: Schema.union(["html", "text"]).default("text").description("返回格式：html(原始HTML) 或 text(纯文本)"),
            max_length: Schema.natural().min(1).default(5000).description("返回内容的最大长度，默认5000字符"),
            max_links: Schema.number().min(0).step(1).default(10).description("最多返回的链接数量，默认 10；设为 0 时不返回链接"),
            include_links: Schema.boolean().hidden(),
            use_dynamic: Schema.boolean().default(false).hidden(),
        }),
    })
    async fetchWebPage(
        args: Infer<{
            url?: string;
            urls?: string[];
            format: "html" | "text";
            max_length: number;
            include_links?: boolean;
            max_links: number;
            use_dynamic: boolean;
        }>,
    ) {
        const { url, urls, format, max_length, include_links, max_links, use_dynamic } = args;
        if (this.config.engineSelection === "configured") {
            if (!this.managed?.canFetch) return Failed("已选引擎不支持网页抓取");
            if (format === "html" || use_dynamic) return Failed("已选引擎只能提取网页正文");
            try {
                args.toolContext?.reportProgress?.("正在通过搜索引擎读取网页");
                const result = await this.managed.fetch(urls?.length ? urls : url ? [url] : [], max_length, args.toolContext?.signal);
                this.logger.debug(`引擎抓取完成 · 成功 ${result.results.filter((page) => !page.error).length}/${result.results.length}`);
                if (!result.results.some((page) => !page.error)) {
                    return Failed(result.results.map((page) => `${page.url}：${page.error}`).join(" · ") || "没有可抓取的网页");
                }
                return Success(result);
            } catch {
                return Failed(args.toolContext?.signal?.aborted ? "网页抓取已取消" : "网页抓取失败，请检查 URL 和数量限制");
            }
        }
        if (!url || isEmpty(url)) return Failed("url is required");
        if (use_dynamic) return Failed("本地提取仅支持静态网页，请改用已选网页提取引擎");
        if (!this.ctx.puppeteer) {
            return Failed("Puppeteer服务未安装或不可用，无法获取网页内容。");
        }

        try {
            // 验证URL格式
            const urlObj = new URL(url);
            if (!["http:", "https:"].includes(urlObj.protocol)) {
                return Failed("只支持HTTP和HTTPS协议");
            }

            args.toolContext?.reportProgress?.("正在读取网页");
            this.logger.debug("开始读取网页");

            const linkLimit = include_links === false ? 0 : max_links;
            const { title, content, textContent, links } = await this.extractStaticPage(url, linkLimit, args.toolContext?.signal);

            args.toolContext?.reportProgress?.("网页已读取，正在提取正文");
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
            if (linkLimit > 0 && links.length > 0) {
                result += `\n\n网页中的其他链接 (${links.length}个):\n`;
                links.forEach((link, index) => {
                    result += `${index + 1}. ${link.text || "(无标题)"}\n   ${link.url}\n`;
                });
            }

            this.logger.debug(`网页正文已提取 · ${resultContent.length} 字 · ${links.length} 个链接`);
            return Success(result);
        } catch (error: any) {
            this.logger.debug(`读取网页失败 · ${error.response?.status ?? error.name ?? "未知错误"}`);
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

    private async extractStaticPage(url: string, maxLinks: number, signal?: AbortSignal) {
        const timeout = AbortSignal.timeout(this.config.httpTimeout);
        const response = await downloadPublicMedia(url, 2 * 1024 * 1024, signal ? AbortSignal.any([timeout, signal]) : timeout);
        if (response.type !== "text/html" && response.type !== "application/xhtml+xml") throw new Error("网页没有返回 HTML");
        signal?.throwIfAborted();
        const page = await this.ctx.puppeteer.page();
        const abort = () => void page.close().catch(() => {});
        signal?.addEventListener("abort", abort, { once: true });
        try {
            signal?.throwIfAborted();
            await page.setJavaScriptEnabled(false);
            await page.setRequestInterception(true);
            page.on("request", (request) => void request.abort().catch(() => {}));
            await page.setContent(response.data.toString("utf8"), {
                waitUntil: "domcontentloaded",
                timeout: this.config.puppeteerTimeout,
            });
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
            signal?.removeEventListener("abort", abort);
            await page.close().catch(() => {});
        }
    }

    @Tool({
        name: "web_search",
        background: true,
        readOnly: true,
        isAvailable(this: SearchExtension) {
            return this.config.engineSelection !== "configured" || !!this.managed?.canSearch;
        },
        timeout(this: SearchExtension) {
            return (this.config.engineSelection === "configured" ? this.config.engineOptions.totalTimeoutMs : this.config.httpTimeout) + 5000;
        },
        description: "搜索网络内容，获取相关信息和链接。可以多次搜索。在你搜索完之后，可以先访问具体内容",
        parameters: withInnerThoughts({
            query: Schema.string().required().description("搜索关键词或查询内容。"),
            limit: Schema.natural().min(1).max(50).description("最多返回的结果数"),
        }),
    })
    async webSearch(args: Infer<{ query: string; limit?: number }>) {
        const { query } = args;

        if (isEmpty(query) || !query.trim()) return Failed("query is required");
        if (this.config.engineSelection === "configured") {
            if (!this.managed?.canSearch) return Failed("没有启用的搜索引擎");
            const limit = Math.max(1, Math.min(args.limit ?? this.config.limit, this.config.engineOptions.maxLimit));
            try {
                args.toolContext?.reportProgress?.("正在向已选引擎搜索");
                const result = await this.managed.search(query, limit, args.toolContext?.signal);
                this.logger.debug(`引擎搜索完成 · ${result.attempts.map((item) => `${item.engine}：${item.error ?? item.count}`).join(" · ")}`);
                return Success(result);
            } catch (error) {
                if (error instanceof SearchDispatchError) {
                    const summary = error.attempts.map((item) => `${item.engine}：${item.error ?? "空结果"}`).join(" · ");
                    this.logger.debug(`引擎搜索失败 · ${summary}`);
                    return Failed({ name: "SearchError", message: `搜索未完成 · ${summary}`, retryable: error.retryable });
                }
                return Failed(args.toolContext?.signal?.aborted ? "搜索已取消" : "搜索引擎请求失败");
            }
        }

        let stage: "请求" | "解码" | "整理" = "请求";
        try {
            const endpoint = this.config.endpoint;
            const engines = this.config.sources.join(",");
            const limit = args.limit ?? this.config.limit;
            const searchUrl = new URL(endpoint);
            searchUrl.searchParams.set("q", query);
            searchUrl.searchParams.set("engines", engines);
            searchUrl.searchParams.set("format", "json");
            searchUrl.searchParams.set("limit", String(limit));

            this.logger.debug("请求搜索服务");

            args.toolContext?.reportProgress?.("正在请求搜索服务");
            // 使用 Koishi 的 HTTP 服务发送请求
            const response: any = await this.ctx.http.get(searchUrl.href, {
                headers: {
                    "User-Agent": this.config.customUA,
                },
                responseType: "json",
                timeout: this.config.httpTimeout,
                signal: args.toolContext?.signal,
            });

            args.toolContext?.reportProgress?.("搜索服务已返回，正在整理结果");
            stage = "解码";
            // 处理响应
            const data = typeof response === "string" ? JSON.parse(response) : response;

            if (!data || !Array.isArray(data.results)) throw new TypeError("invalid search response");
            stage = "整理";
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

            this.logger.debug(`搜索服务返回 ${topResults.length} 项结果`);

            // 如果启用了Puppeteer，添加提示信息
            if (this.ctx.puppeteer) {
                resultText += `\n提示：你可以使用 <fetch_webpage> 工具获取链接的详细内容。旧端点模式支持静态网页。`;
            }

            return Success(resultText);
        } catch (error) {
            const status = error?.response?.status;
            const code = error?.code ?? error?.cause?.code;
            const timedOut = typeof status !== "number" && (code === "ETIMEDOUT" || error?.name === "TimeoutError");
            const retryableStatus = typeof status === "number" && (status === 408 || status === 429 || (status >= 500 && status < 600));
            const networkCodes = ["EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"];
            const networkCode = typeof code === "string" && networkCodes.includes(code) ? code : undefined;
            if (error instanceof SyntaxError) stage = "解码";
            const detail = args.toolContext?.signal?.aborted
                ? "已取消"
                : timedOut
                  ? "搜索请求超时"
                  : typeof status === "number"
                    ? `HTTP ${status}`
                    : (networkCode ?? "未返回可用的搜索结果");
            this.logger.debug(`搜索服务 · ${stage}失败 · ${detail}`);
            return Failed({
                name: timedOut ? "TimeoutError" : "SearchError",
                message: timedOut ? detail : `搜索服务${stage}失败：${detail}`,
                retryable: !args.toolContext?.signal?.aborted && (timedOut || retryableStatus || !!networkCode),
            });
        }
    }
}
