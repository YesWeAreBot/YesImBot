import * as fs from "fs/promises";
import { Context, Logger, Schema, sleep } from "koishi";
import {} from "koishi-plugin-puppeteer";
import {
    AssetService,
    Extension,
    Failed,
    Infer,
    Success,
    Tool,
    ToolCallResult,
    withInnerThoughts,
} from "koishi-plugin-yesimbot/services";
import { Services } from "koishi-plugin-yesimbot/shared";
import * as os from "os";
import * as path from "path";
import type { Page } from "puppeteer-core";
import { FormData, ProxyAgent, RequestInit, fetch as ufetch } from "undici";

namespace GoogleVisionApi {
    export interface IPageWithMatchingImages {
        url: string;
        pageTitle: string;
        fullMatchingImages?: { url: string }[];
        partialMatchingImages?: { url: string }[];
    }

    export interface IWebEntity {
        entityId: string;
        score: number;
        description: string;
    }

    export interface IBestGuessLabel {
        label: string;
        languageCode?: string;
    }

    export interface IWebDetection {
        webEntities: IWebEntity[];
        fullMatchingImages: { url: string }[];
        partialMatchingImages: { url: string }[];
        pagesWithMatchingImages: IPageWithMatchingImages[];
        bestGuessLabels: IBestGuessLabel[];
    }

    export interface IVisionApiResponse {
        responses: {
            webDetection: IWebDetection;
        }[];
    }
}
namespace SerpApi {
    export interface SearchInformation {
        query_displayed: string;
        total_results: number;
        time_taken_displayed: number;
        organic_results_state: string;
    }
    export interface ImageSize {
        title: string;
        link: string;
        serpapi_link: string;
    }

    export interface InlineImage {
        link: string;
        source: string;
        thumbnail: string;
        original: string;
        title: string;
    }

    export interface Source {
        name: string;
        link: string;
    }

    export interface SpouseLink {
        text: string;
        link: string;
    }

    export interface ChildrenLink {
        text: string;
        link: string;
    }

    export interface EducationLink {
        text: string;
        link: string;
    }

    export interface Profile {
        name: string;
        link: string;
        source: string;
        image: string;
    }

    export interface PeopleAlsoSearchFor {
        name: string;
        extensions: string[];
        link: string;
        source: string;
        image: string;
    }

    export interface KnowledgeGraph {
        title: string;
        type: string;
        image: string;
        description: string;
        source: Source;
        born: string;
        height: string;
        net_worth: string;
        spouse: string;
        spouse_links: SpouseLink[];
        children: string;
        children_links: ChildrenLink[];
        education: string;
        education_links: EducationLink[];
        profiles: Profile[];
        people_also_search_for: PeopleAlsoSearchFor[];
        people_also_search_for_link: string;
        people_also_search_for_stick: string;
    }

    export interface ImageResult {
        redirect_link: string;
        position: number;
        title: string;
        link: string;
        displayed_link: string;
        snippet: string;
        cached_page_link: string;
        related_pages_link: string;
        thumbnail?: string; //  "thumbnail" and "date" are optional as they don't appear in all image_results objects.
        date?: string;
    }

    export interface ISerpApiResponse {
        search_information: SearchInformation;
        image_sizes: ImageSize[];
        inline_images: InlineImage[];
        knowledge_graph: KnowledgeGraph;
        image_results: ImageResult[];
    }
}
namespace GoogleLensApi {
    export interface SearchMetadata {
        id: string;
        status: string;
        json_endpoint: string;
        created_at: string;
        processed_at: string;
        google_lens_url: string;
        raw_html_file: string;
        total_time_taken: number;
    }

    export interface SearchParameters {
        engine: string;
        url: string;
        hl: string;
        country: string;
    }

    export interface VisualMatch {
        position: number;
        title: string;
        link: string;
        source: string;
        source_icon: string;
        thumbnail: string;
        thumbnail_width: number;
        thumbnail_height: number;

        image_width: number;
        image_height: number;
    }

    export interface GoogleLensResult {
        search_metadata: SearchMetadata;
        search_parameters: SearchParameters;
        visual_matches: VisualMatch[];
    }
}

/**
 * 定义 Google Lens 返回结果的结构，分为三部分：
 * 1. directResults: 页面首次加载时呈现的直接文本匹配结果。
 * 2. visualMatches: "完全匹配结果"页面中的视觉相似图片结果。
 * 3. relatedSearches: Google 建议的相关搜索词条，通常是对图片内容的高度概括。
 */
export interface GoogleLensResult {
    directResults: { title: string; link: string }[];
    visualMatches: { title: string; link: string }[];
    relatedSearches: { title: string; link: string }[];
}

/**
 * 为抓取器定义配置选项，允许外部传入限制。
 */
export interface LensScraperOptions {
    limits: {
        directResults: number;
        visualMatches: number;
        relatedSearches: number;
    };
}

export interface Config {
    engine: "google_lens_scraper" | "google_lens_serpapi" | "google_vision" | "serpapi_reverse_image";
    proxy?: string;
    serpapi?: {
        api_key: string;
    };
    googleVision?: {
        api_key: string;
    };
    uploader?: {
        apiKey: string;
    };
}

export const Config: Schema<Config> = Schema.object({
    engine: Schema.union(["google_lens_scraper", "google_lens_serpapi", "google_vision", "serpapi_reverse_image"])
        .default("google_lens_scraper")
        .description("默认使用的图片搜索引擎"),
    proxy: Schema.string().description("SOCKS 或 HTTP 代理地址，例如：`socks5://127.0.0.1:1080`。"),
    serpapi: Schema.object({
        api_key: Schema.string().role("secret").description("SerpApi 的 API Key，用于 Google Lens 和反向图片搜索。"),
    }).description("SerpApi 服务配置"),
    googleVision: Schema.object({
        api_key: Schema.string().role("secret").description("Google Cloud Vision API Key，用于传统的图片内容分析。"),
    }).description("Google Vision 服务配置"),
    uploader: Schema.object({
        apiKey: Schema.string()
            .role("secret")
            .description("Imgur.la 图床的 API Key，用于上传图片以获取 SerpApi 所需的公开 URL。"),
    }).description("临时图片上传服务配置"),
});

const scriptToInject = () => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    //@ts-ignore
    window.chrome = { runtime: {} };
};

@Extension({
    name: "vision-tools",
    display: "视觉分析工具",
    description: "提供多种引擎的反向图片搜索、来源分析和浏览器抓取功能",
    version: "1.0.0",
})
export default class VisionTools {
    static readonly inject = {
        required: [Services.Asset],
        optional: ["puppeteer"],
    };
    static readonly Config = Config;

    // --- Google Vision 常量 ---
    private static readonly GOOGLE_VISION_API_URL = "https://vision.googleapis.com/v1/images:annotate";
    private static readonly WEB_DETECTION_MAX_RESULTS = 15;
    private static readonly WEB_ENTITY_MIN_SCORE = 0.6;
    private static readonly PAGE_RESULTS_LIMIT = 3;
    private static readonly ENTITY_RESULTS_LIMIT = 5;

    private readonly logger: Logger;

    constructor(private ctx: Context, private config: Config) {
        this.logger = ctx.get(Services.Logger).getLogger("[视觉工具]");
        this.ctx.on("ready", async () => {
            this.logger.info("增强视觉工具已加载");
            this.setupPuppeteerAntiDetection();
        });
    }

    /** 注入反检测脚本到 Puppeteer 页面 */
    private setupPuppeteerAntiDetection() {
        const puppeteer = this.ctx.puppeteer;
        if (puppeteer?.browser) {
            this.logger.info("✅ 检测到 Puppeteer 服务，正在附加反检测逻辑...");
            puppeteer.browser.on("targetcreated", async (target) => {
                if (target.type() === "page") {
                    try {
                        const page = await target.page();
                        if (page) {
                            await page.evaluateOnNewDocument(scriptToInject);
                        }
                    } catch (error) {
                        // 目标页面可能在注入前关闭，可以安全忽略
                    }
                }
            });
            this.logger.info("👍 反检测逻辑已附加到所有未来页面。");
        } else {
            this.logger.warn("⚠️ 未找到 Puppeteer 服务或浏览器实例，浏览器抓取功能将不可用。");
        }
    }

    @Tool({
        name: "search_image_source",
        description: "对图片进行反向搜索，查找其网络来源、识别内容（角色、作品、梗）或寻找视觉上相似的图片。",
        parameters: withInnerThoughts({
            image_id: Schema.string()
                .required()
                .description("要搜索的图片ID，例如在 `<img id='12345'>` 中的 `12345`。"),
        }),
    })
    public async searchImageSource(args: Infer<{ image_id: string; method: string }>): Promise<ToolCallResult> {
        const { image_id, method } = args;
        this.logger.info(`请求使用方法: ${method}`);

        const assetService = this.ctx.get(Services.Asset);
        const image = await assetService.getAssetDataWithContent(image_id);
        if (!image?.content || !image.data.mime.startsWith("image/")) {
            return Failed(`图片获取失败 (ID: ${image_id})，请确认图片ID是否正确。`);
        }

        switch (this.config.engine) {
            case "google_lens_serpapi":
                return this.searchImageSourceWithGoogleLens(image_id, image);
            case "google_lens_scraper":
                return this.searchImageSourceWithGoogleLensScraper(image_id, image);
            case "google_vision":
                return this.searchImageSourceWithGoogleVision(image_id, image);
            case "serpapi_reverse_image":
                return this.searchImageSourceWithSerpApi(image_id, image);
            default:
                return Failed("没有可用的图片搜索服务，请检查插件配置。");
        }
    }

    // --- 各引擎的具体实现 ---

    /**
     * @method searchImageSourceWithGoogleVision
     * @description 使用 Google Vision API 进行图像分析。
     */
    private async searchImageSourceWithGoogleVision(image_id: string, image: { content: string }) {
        const logPrefix = `[VisionAPI][${image_id}]`;
        const GOOGLE_API_KEY = this.config.googleVision?.api_key;
        if (!GOOGLE_API_KEY) {
            this.logger.warn(`${logPrefix} 调用失败，Google Vision API 密钥未配置`);
            return Failed("管理员未配置Google Vision API密钥，无法使用此功能");
        }

        try {
            const base64Image = image.content.substring(image.content.indexOf(",") + 1);
            const requestPayload = {
                requests: [
                    {
                        image: { content: base64Image },
                        features: [{ type: "WEB_DETECTION", maxResults: VisionTools.WEB_DETECTION_MAX_RESULTS }],
                    },
                ],
            };

            const visionApiUrl = `${VisionTools.GOOGLE_VISION_API_URL}?key=${GOOGLE_API_KEY}`;
            const response = await this.fetchWithProxy(visionApiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestPayload),
            });

            const data = (await response.json()) as GoogleVisionApi.IVisionApiResponse;
            const webDetection = data?.responses?.[0]?.webDetection;

            if (!webDetection) {
                this.logger.info(`${logPrefix} API 未返回有效的 webDetection 结果`);
                return Success(
                    "分析完成，但未能从网络上找到关于此图片的明确信息。可能是一张个人原创图片或非常新的内容。"
                );
            }
            return Success(this.formatWebDetectionResult(webDetection));
        } catch (error) {
            this.logger.error(`${logPrefix} 搜索失败: %o`, error);
            return Failed(`[VisionAPI] 搜索失败: ${error.message}`);
        }
    }

    /**
     * @method searchImageSourceWithSerpApi
     * @description 使用 SerpApi 的 `google_reverse_image` 引擎进行搜索。
     */
    private async searchImageSourceWithSerpApi(image_id: string, image: { data: { mime: string } }) {
        const logPrefix = `[SerpApi-Reverse][${image_id}]`;
        const SERPAPI_KEY = this.config.serpapi?.api_key;
        if (!SERPAPI_KEY) return Failed("管理员未配置SerpApi密钥。");

        try {
            const imageUrl = await this.uploadImage(image_id, image);
            if (!imageUrl) return Failed("图片上传失败，无法继续搜索。");

            const serpApiUrl = new URL("https://serpapi.com/search.json");
            serpApiUrl.searchParams.set("engine", "google_reverse_image");
            serpApiUrl.searchParams.set("image_url", imageUrl);
            serpApiUrl.searchParams.set("api_key", SERPAPI_KEY);
            serpApiUrl.searchParams.set("hl", "zh-cn");

            const response = await this.fetchWithProxy(serpApiUrl);
            const data = (await response.json()) as SerpApi.ISerpApiResponse;

            if (!data.knowledge_graph && (!data.image_results || data.image_results.length === 0)) {
                return Success("分析完成，但在网络上未能找到与此图片相关的明确信息。");
            }
            return Success(this.formatSerpApiResult(data));
        } catch (error) {
            this.logger.error(`${logPrefix} 搜索失败: %o`, error);
            return Failed(`[SerpApi-Reverse] 搜索失败: ${error.message}`);
        }
    }

    /**
     * @method searchImageSourceWithGoogleLens
     * @description 使用 SerpApi 的 `google_lens` 引擎进行搜索。
     */
    async searchImageSourceWithGoogleLens(image_id: string, image: { content: string; data: { mime: string } }) {
        const logPrefix = `[SerpApi-Lens][${image_id}]`;
        const SERPAPI_KEY = this.config.serpapi?.api_key;
        if (!SERPAPI_KEY) return Failed("管理员未配置SerpApi密钥。");

        try {
            const imageUrl = await this.uploadImage(image_id, image);
            if (!imageUrl) return Failed("图片上传失败，无法继续搜索。");

            const serpApiUrl = new URL("https://serpapi.com/search.json");
            serpApiUrl.searchParams.set("engine", "google_lens");
            serpApiUrl.searchParams.set("url", imageUrl);
            serpApiUrl.searchParams.set("api_key", SERPAPI_KEY);
            serpApiUrl.searchParams.set("hl", "zh-cn");

            const response = await this.fetchWithProxy(serpApiUrl);
            const data = (await response.json()) as GoogleLensApi.GoogleLensResult;

            if (!data.visual_matches || data.visual_matches.length === 0) {
                return Success("分析完成，但Google Lens未能找到此图片的任何视觉匹配项。");
            }

            return Success(this.formatGoogleLensResult(data));
        } catch (error) {
            this.logger.error(`${logPrefix} 搜索失败: %o`, error);
            return Failed(`[SerpApi-Lens] 搜索失败: ${error.message}`);
        }
    }

    /**
     * @method searchImageSourceWithGoogleLensScraper
     * @description 使用 Puppeteer 直接抓取 Google Lens 网站。
     */
    async searchImageSourceWithGoogleLensScraper(image_id: string, image: { content: string; data: { mime: string } }) {
        const logPrefix = `[Lens-Scraper][${image_id}]`;
        if (!this.ctx.puppeteer?.browser) return Failed("Puppeteer 服务未启动，无法使用浏览器抓取功能。");

        let tempDirPath: string | undefined;
        try {
            // 1. 创建临时文件
            tempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), "vision-tools-"));
            const tempImagePath = path.join(tempDirPath, `image.${image.data.mime.split("/")[1] || "jpg"}`);
            const imageBuffer = Buffer.from(image.content.split(",")[1], "base64");
            await fs.writeFile(tempImagePath, imageBuffer);
            this.logger.info(`${logPrefix} 临时图片已保存到: ${tempImagePath}`);

            // 2. 执行抓取
            const result = await this.runGoogleLensScraper(tempImagePath);
            if (!result) {
                return Failed("浏览器抓取失败，未返回任何结果。");
            }

            // 3. 格式化并返回结果
            return Success(this.formatGoogleLensScraperResult(result));
        } catch (error) {
            this.logger.error(`${logPrefix} 抓取过程中发生错误: %o`, error);
            return Failed(`[Lens-Scraper] 抓取失败: ${error.message}`);
        } finally {
            // 4. 清理临时文件
            if (tempDirPath) {
                await fs.rm(tempDirPath, { recursive: true, force: true });
                this.logger.info(`${logPrefix} 临时文件目录已清理: ${tempDirPath}`);
            }
        }
    }

    // --- 辅助函数 (格式化、上传、抓取核心逻辑) ---

    private formatWebDetectionResult(webDetection: GoogleVisionApi.IWebDetection): string {
        const summaryParts: string[] = ["### 图片网络来源分析报告 (Google Vision)"];
        if (webDetection.bestGuessLabels?.length > 0) {
            summaryParts.push("\n**[最佳猜测]**", webDetection.bestGuessLabels.map((l) => l.label).join(", "));
        }
        const entities = webDetection.webEntities
            ?.filter((e) => e.score > VisionTools.WEB_ENTITY_MIN_SCORE)
            .slice(0, VisionTools.ENTITY_RESULTS_LIMIT)
            .map((e) => `- ${e.description || "未知实体"} (相关度: ${Math.round(e.score * 100)}%)`);
        if (entities?.length > 0) {
            summaryParts.push("\n**[相关实体]**", ...entities);
        }
        const pages = webDetection.pagesWithMatchingImages
            ?.slice(0, VisionTools.PAGE_RESULTS_LIMIT)
            .map((p) => `- 标题: ${p.pageTitle?.trim() || "无标题"}\n  链接: ${p.url}`);
        if (pages?.length > 0) {
            summaryParts.push("\n**[来源网页参考]**", ...pages);
        }
        if (summaryParts.length <= 1) return "分析完成，但未能从网络上找到关于此图片的明确信息。";
        return summaryParts.join("\n");
    }

    private formatSerpApiResult(data: SerpApi.ISerpApiResponse): string {
        const { search_information, knowledge_graph, image_results } = data;
        const summaryParts: string[] = ["### 图片网络来源深度分析报告 (SerpApi Reverse Image)"];
        const primaryTopic = search_information?.query_displayed;
        if (primaryTopic) summaryParts.push(`\n**[💡 核心主题]**\n图片最相关的主题是：**${primaryTopic}**`);
        if (knowledge_graph?.title) {
            summaryParts.push(
                "\n**[✅ 知识图谱]**",
                `- **名称**: ${knowledge_graph.title} (${knowledge_graph.type || "未知类型"})`,
                `- **简介**: ${knowledge_graph.description}`
            );
        }
        if (image_results?.length > 0) {
            summaryParts.push("\n**[🌐 来源网页参考]**");
            const pages = image_results
                .slice(0, 5)
                .map((s) => `- **标题**: ${s.title}\n  **链接**: ${s.redirect_link || s.link}`);
            summaryParts.push(...pages);
        }
        if (summaryParts.length <= 1) return "分析完成，但未能从网络上找到关于此图片的明确信息。";
        return summaryParts.join("\n");
    }

    private formatGoogleLensResult(data: GoogleLensApi.GoogleLensResult): string {
        const summaryParts: string[] = ["### 图片深度视觉分析报告 (Google Lens via SerpApi)"];
        const { visual_matches } = data;
        if (visual_matches && visual_matches.length > 0) {
            summaryParts.push("\n**[📸 视觉匹配结果]**", "以下是网络上找到的高度相似的图片及其来源：");
            const matches = visual_matches
                .slice(0, 5)
                .map((match) => `- **标题**: ${match.title}\n  **来源**: ${match.source}\n  **链接**: ${match.link}`);
            summaryParts.push(...matches);
        } else {
            return "分析完成，但Google Lens未能找到此图片的任何视觉匹配项。";
        }
        return summaryParts.join("\n");
    }

    /**
     * 将抓取到的 Google Lens 结果格式化为易于阅读的报告。
     * @param data - 包含三部分结果的 GoogleLensResult 对象。
     * @returns 格式化后的 Markdown 字符串。
     */
    private formatGoogleLensScraperResult(data: GoogleLensResult): string {
        const { directResults, visualMatches, relatedSearches } = data;
        const summaryParts: string[] = ["### ✨ 图片深度分析报告 (Google Lens)"];

        // 优先并突出显示“相关搜索”，因为它们提供了对图片的核心分类
        if (relatedSearches.length > 0) {
            summaryParts.push("\n**[💡 核心摘要：相关搜索]**");
            summaryParts.push(relatedSearches.map((topic) => `- ${topic.title}\n  ${topic.link}`).join("\n"));
        } else {
            summaryParts.push("\n**[💡 核心摘要：相关搜索]**");
            summaryParts.push("未能找到相关搜索建议。");
        }

        // 显示视觉上完全匹配的结果
        if (visualMatches.length > 0) {
            summaryParts.push("\n**[📸 视觉匹配结果]**");
            visualMatches.forEach((result) => {
                summaryParts.push(`- **标题**: ${result.title}\n  **来源**: ${result.link}`);
            });
        }

        // 显示直接的网页搜索结果
        if (directResults.length > 0) {
            summaryParts.push("\n**[📄 直接搜索结果]**");
            directResults.forEach((result) => {
                summaryParts.push(`- **标题**: ${result.title}\n  **链接**: ${result.link}`);
            });
        }

        if (directResults.length === 0 && visualMatches.length === 0 && relatedSearches.length === 0) {
            return "分析完成，但未能从 Google Lens 找到任何有效的匹配结果或相关主题。";
        }

        return summaryParts.join("\n");
    }

    private async fetchWithProxy(url: URL | string, init: RequestInit = {}) {
        const proxyUrl = this.config.proxy;
        if (proxyUrl) {
            this.logger.info(`› 使用代理: ${proxyUrl}`);
            init.dispatcher = new ProxyAgent(proxyUrl);
        }
        const response = await ufetch(url, init);
        if (!response.ok) {
            const errorBody = await response.text();
            this.logger.error(`请求失败 (${response.status}): ${errorBody}`);
            throw new Error(`API 请求失败 (状态 ${response.status}): ${errorBody}`);
        }
        return response;
    }

    private async uploadImage(image_id: string, image: { data: { mime: string } }): Promise<string | null> {
        const apiKey = this.config.uploader?.apiKey;
        if (!apiKey) {
            this.logger.error("图片上传失败：未配置 uploader.apiKey。");
            return null;
        }

        const assetService = this.ctx.get(Services.Asset);
        const imageBuffer = await assetService.read(image_id);
        const file = new File([imageBuffer], `image.${image.data.mime.split("/")[1] || "jpeg"}`, {
            type: image.data.mime,
        });

        const formData = new FormData();
        formData.append("source", file);
        formData.append("key", apiKey);

        try {
            const response = await ufetch("https://imgur.la/api/1/upload", {
                method: "POST",
                body: formData,
            });
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`图床API错误 (状态 ${response.status}): ${errorBody}`);
            }
            const responseData: any = await response.json();
            if (responseData?.status_code === 200) {
                this.logger.info(`› 图片上传成功，URL: ${responseData.image.url}`);
                return responseData.image.url;
            }
            throw new Error(`图床返回未知数据: ${JSON.stringify(responseData)}`);
        } catch (error) {
            this.logger.error(`✖ 图片上传失败: ${error.message}`);
            return null;
        }
    }

    /**
     * 执行 Google Lens 图片搜索并抓取结果。
     * @param imagePath - 本地图片的路径。
     * @param options - 抓取选项，包含对各类结果数量的限制。
     * @returns 一个包含三部分结果的 Promise<GoogleLensResult>。
     */
    private async runGoogleLensScraper(
        imagePath: string,
        options: LensScraperOptions = {
            limits: { directResults: 5, visualMatches: 10, relatedSearches: 10 },
        }
    ): Promise<GoogleLensResult> {
        this.logger.info("🚀 启动浏览器抓取...");
        const page = await this.ctx.puppeteer.page();
        try {
            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
            );

            this.logger.info("🌍 导航到 Google Lens 并准备上传...");
            await page.goto("https://lens.google.com/search?p", { waitUntil: "domcontentloaded" });

            const uploadInputSelector = 'input[type="file"]';
            const inputElement = await page.waitForSelector(uploadInputSelector);
            await inputElement.uploadFile(imagePath);
            this.logger.info(`🖼️ 图片上传成功: ${imagePath}`);

            this.logger.info("⏳ 等待初始识别结果加载...");
            await page.waitForSelector('div[role="navigation"] ::-p-text(全部)', { timeout: 30000 });
            this.logger.info("✅ 初始结果页面加载完成！");

            await sleep(1000);

            // AI Hint
            const aiHintSelector = "div[jsname][data-rl][data-lht]";
            const aiHint = await page
                .$eval(aiHintSelector, (el) => (el as HTMLElement).innerText.trim())
                .catch(() => null);
            if (aiHint) {
                this.logger.info(`💡 AI 提示: ${aiHint}`);
            }

            this.logger.info("📄 正在分析页面内容...");
            const mainContainerSelector = 'div[role="main"] div[data-snc][data-snm]';
            await page.waitForSelector(mainContainerSelector, { timeout: 10000 });

            const directResults: { title: string; link: string }[] = [];
            const relatedSearches: { title: string; link: string }[] = [];
            let visualMatchesUrl: string | null = null;

            const allBlockHandles = await page.$$(`${mainContainerSelector} > div`);
            this.logger.debug(`🔍 发现 ${allBlockHandles.length} 个顶级内容块，开始遍历...`);

            for (const blockHandle of allBlockHandles) {
                if (directResults.length >= options.limits.directResults) {
                    break;
                }
                const h2Text = await blockHandle.$eval("h2", (el) => el.innerText.trim()).catch(() => null);

                // 提取相关搜索
                if (h2Text === "相关搜索" || h2Text === "Related searches") {
                    this.logger.debug("  -> 识别到“相关搜索”块");
                    const links = await blockHandle.$$eval("a", (els) =>
                        els.map((el) => ({ title: (el as HTMLElement).innerText.trim(), link: el.href }))
                    );
                    relatedSearches.push(...links);
                    continue;
                }

                const mainLinkHandle = await blockHandle.$("a");
                if (!mainLinkHandle) continue;

                const linkText = await mainLinkHandle.evaluate((el) => (el as HTMLElement).innerText);

                // 提取“完全匹配”页面的链接
                if (linkText.includes("查看完全匹配的结果") || linkText.includes("See all visual matches")) {
                    this.logger.debug("  -> 识别到“查看完全匹配的结果”链接");
                    visualMatchesUrl = await mainLinkHandle.evaluate((el) => el.href);
                    continue;
                }

                // 提取直接结果
                const heading = await mainLinkHandle
                    .$eval('div[role="heading"]', (el) => (el as HTMLElement).innerText.trim())
                    .catch(() => null);
                if (heading) {
                    const link = await mainLinkHandle.evaluate((el) => el.href);
                    directResults.push({ title: heading, link });
                    this.logger.debug(`  -> 提取到常规结果: ${heading.substring(0, 30)}...`);
                }
            }

            // 应用配置中的数量限制
            const finalDirectResults = directResults.slice(0, options.limits.directResults);
            const finalRelatedSearches = relatedSearches.slice(0, options.limits.relatedSearches);

            this.logger.info(`  - 初始页面找到 ${finalDirectResults.length}/${directResults.length} 条直接结果。`);
            this.logger.info(`  - 找到 ${finalRelatedSearches.length}/${relatedSearches.length} 个“相关搜索”主题。`);

            let visualMatches: { title: string; link: string }[] = [];
            if (visualMatchesUrl) {
                this.logger.info(
                    `  - 找到“完全匹配”页链接，准备跳转抓取最多 ${options.limits.visualMatches} 条结果...`
                );
                await page.goto(visualMatchesUrl, { waitUntil: "networkidle2" });
                // 传入数量限制
                visualMatches = await this.scrapeGoogleSearchResultsPage(page, options.limits.visualMatches);
            }

            this.logger.info(`✨ 抓取完成！`);

            return {
                directResults: finalDirectResults,
                visualMatches: visualMatches,
                relatedSearches: finalRelatedSearches,
            };
        } catch (error) {
            this.logger.error("❌ 浏览器抓取操作过程中发生严重错误:", error);
            await page.screenshot({ path: `fatal_error_${Date.now()}.png` }).catch(() => {});
            throw error;
        } finally {
            this.logger.info("🎬 关闭页面...");
            await page.close();
        }
    }

    /**
     * 专门用于抓取 Google“视觉匹配”结果页面的函数。
     * @param page - Puppeteer 的 Page 对象。
     * @param limit - 需要抓取的结果数量上限。
     * @returns 包含标题和链接的结果数组。
     */
    // 添加 limit 参数，使其更通用
    private async scrapeGoogleSearchResultsPage(page: Page, limit: number): Promise<{ title: string; link: string }[]> {
        this.logger.info(`🔎 正在抓取页面: ${page.url()}，上限 ${limit} 条`);
        const searchResultLinksSelector = 'div[id="rso"] a';

        try {
            await page.waitForSelector(searchResultLinksSelector, { timeout: 10000 });

            // 使用 page.$$eval 一次性完成提取，更高效
            const results = await page.$$eval(
                `${searchResultLinksSelector}`,
                (links, titleSelector, limit) => {
                    const extracted: { title: string; link: string }[] = [];
                    const uniqueLinks = new Set<string>();

                    for (const link of links) {
                        if (extracted.length >= limit) break;

                        const href = (link as HTMLAnchorElement).href;
                        // 跳过无效链接或重复链接
                        if (!href || uniqueLinks.has(href)) continue;

                        const titleElement = link.querySelector(titleSelector);
                        if (titleElement) {
                            const title = titleElement.textContent?.trim();
                            if (title) {
                                extracted.push({ title, link: href });
                                uniqueLinks.add(href);
                            }
                        }
                    }
                    return extracted;
                },
                'div[style*="-webkit-line-clamp"]',
                limit
            );

            if (results.length > 0) {
                this.logger.info(`✅ 在该页面找到 ${results.length} 条有效结果。`);
            } else {
                this.logger.warn(`⚠️ 未能使用指定选择器找到任何结果。页面结构可能已改变。`);
            }
            return results;
        } catch (error) {
            this.logger.error(`⚠️ 在页面 ${page.url()} 上抓取搜索结果时出错:`, error);
            await page.screenshot({ path: `scrape_error_${Date.now()}.png` });
            return [];
        }
    }
}
