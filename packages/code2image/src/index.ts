import { Context, h, Logger, Schema } from "koishi";

import {} from "koishi-plugin-puppeteer";

import { Extension, Failed, Infer, Success, Tool, withInnerThoughts } from "koishi-plugin-yesimbot/services";
import {
    bundledLanguages,
    BundledTheme,
    bundledThemes,
    createHighlighter,
    Highlighter,
    BuiltinLanguage,
    BuiltinTheme,
} from "shiki";
import { promises as fs } from "fs";
import * as path from "path";

// 使用 Logger 创建一个独立的日志记录器，便于区分插件日志
const logger = new Logger("code2image");

// 定义生成图片时可以覆盖的选项
interface RenderOptions {
    code: string;
    lang?: BuiltinLanguage;
    theme?: BuiltinTheme | string;
    fontFamily?: string;
    fontSize?: number;
    padding?: number;
}

// 插件配置接口
export interface CodeToImageConfig {
    fontDirectory: string;
    defaultFontFamily: string;
    defaultTheme: BuiltinTheme | string;
    defaultFontSize: number;
    defaultPadding: number;
}

@Extension({
    name: "code2image",
    display: "代码转图片",
    version: "1.1.0",
    description: "将代码块高质量地渲染为图片，支持自定义字体和主题",
})
export default class CodeToImage {
    // Schema 定义，提供更详细的描述和类型
    static readonly Config: Schema<CodeToImageConfig> = Schema.object({
        defaultTheme: Schema.union(Object.keys(bundledThemes))
            .default("github-light")
            .description("代码高亮的默认主题"),
        fontDirectory: Schema.path({ filters: ["directory"], allowCreate: true })
            .role("path")
            .default("data/code2image/fonts")
            .description("存放自定义字体文件（.ttf, .otf, .woff2）的目录路径。留空则不加载本地字体"),
        defaultFontFamily: Schema.string()
            .default("JetBrains Mono")
            .description("默认使用的字体名称。需确保该字体已在 `fontDirectory` 中或为系统预装字体"),
        defaultFontSize: Schema.number().min(10).default(18).description("默认字体大小（单位：px）"),
        defaultPadding: Schema.number().min(0).default(40).description("图片默认内边距（单位：px）"),
    });

    static readonly inject = ["puppeteer"];

    private highlighter: Highlighter;
    private localFonts: Map<string, string> = new Map();

    constructor(public ctx: Context, public config: CodeToImageConfig) {
        // 在构造函数中直接监听 ready 事件
        ctx.on("ready", async () => {
            try {
                await this.initialize();
                logger.info("插件已成功启动");
            } catch (error) {
                logger.error("插件初始化失败！");
                logger.error(error);
            }
        });
    }

    /**
     * 初始化 Shiki 高亮器和加载本地字体
     */
    private async initialize() {
        logger.info("正在初始化 Shiki 高亮器...");
        this.highlighter = await createHighlighter({
            themes: [this.config.defaultTheme],
            langs: Object.keys(bundledLanguages),
        });
        logger.info("Shiki 高亮器初始化完成");

        await this.loadLocalFonts();

        this.defineCommands();
    }

    /**
     * 扫描并加载配置目录中的字体文件
     */
    private async loadLocalFonts() {
        if (!this.config.fontDirectory) {
            logger.info("未配置字体目录，将跳过加载本地字体");
            return;
        }

        try {
            const files = await fs.readdir(this.config.fontDirectory);
            const fontExtensions = [".ttf", ".otf", ".woff", ".woff2"];

            for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                if (fontExtensions.includes(ext)) {
                    // 使用文件名（不含扩展名）作为字体族名
                    // 例如 "My-Awesome-Font.ttf" -> "My-Awesome-Font"
                    const fontFamily = path.basename(file, ext);
                    const fullPath = path.join(this.config.fontDirectory, file);
                    this.localFonts.set(fontFamily, fullPath);
                    logger.info(`已加载本地字体: "${fontFamily}" -> ${fullPath}`);
                }
            }
        } catch (error) {
            logger.warn(`加载本地字体失败: 无法读取目录 ${this.config.fontDirectory}`);
            logger.warn(error);
        }
    }

    /**
     * 核心功能：将代码渲染为图片 Buffer
     * @param options 渲染选项
     * @returns 成功时返回图片的 Buffer，失败时返回错误信息字符串
     */
    private async generateImage(options: RenderOptions): Promise<Buffer | string> {
        if (!this.highlighter) {
            return "代码高亮服务尚未准备就绪，请稍后再试";
        }

        // 合并用户输入和默认配置
        const {
            code,
            lang = "plaintext",
            theme = this.config.defaultTheme,
            fontFamily = this.config.defaultFontFamily,
            fontSize = this.config.defaultFontSize,
            padding = this.config.defaultPadding,
        } = options;

        logger.info(`开始生成图片: lang=${lang}, theme=${theme}, font=${fontFamily}`);

        try {
            // 动态加载 Shiki 主题和语言
            await this.highlighter.loadTheme(theme as BundledTheme);
            const loadedLanguages = this.highlighter.getLoadedLanguages();
            if (!loadedLanguages.includes(lang)) {
                try {
                    await this.highlighter.loadLanguage(lang);
                } catch (e) {
                    logger.warn(`尝试加载语言 "${lang}" 失败: ${e.message}`);
                    return `不支持的语言: ${lang}。请检查语言名称是否正确。`;
                }
            }

            // 1. 生成 HTML 片段
            const htmlFragment = this.highlighter.codeToHtml(code, { lang, theme });

            // 2. 获取主题背景色
            const themeData = this.highlighter.getTheme(theme);
            const backgroundColor = themeData.bg;

            // 3. 构建完整 HTML 页面
            const fullHtml = this.createHtmlPage({
                fragment: htmlFragment,
                backgroundColor,
                fontFamily,
                fontSize,
                padding,
            });

            // 4. 使用 Puppeteer 渲染
            const imageBuffer = await this.ctx.puppeteer.render(fullHtml, async (page, next) => {
                const container = await page.$(".container");
                if (!container) throw new Error("无法在 Puppeteer 页面中找到 .container 元素");
                return next(container);
            });

            logger.info("图片生成成功");
            return Buffer.from(imageBuffer);
        } catch (error) {
            logger.error("生成图片时发生严重错误：");
            logger.error(error);
            return `生成图片时出错: ${error.message}`;
        }
    }

    private defineCommands() {
        // 用户指令
        this.ctx
            .command("code <code:text>", "将代码块渲染为图片发送")
            .usage('可以直接跟随代码，或使用 Markdown 语法。例如：\n`code ```ts\nconsole.log("Hello, Koishi!");\n```')
            .option("lang", "-l <lang:string> 指定代码语言")
            .option("theme", "-t <theme:string> 指定高亮主题")
            .option("font", "-f <font:string>指定字体 ")
            .action(async ({ session, options }, code) => {
                if (!code) return session.execute("help code");

                // 从 Markdown 代码块中提取代码和语言
                const mdCodeBlockRegex = /^```(\S+)?\s*\n([\s\S]+)\n```$/;
                const match = code.match(mdCodeBlockRegex);
                if (match) {
                    options.lang = match[1] || options.lang;
                    code = match[2];
                }

                await session.send("正在生成图片，请稍候...");

                const result = await this.generateImage({
                    code,
                    lang: options.lang as BuiltinLanguage,
                    theme: options.theme,
                    fontFamily: options.font,
                });

                if (Buffer.isBuffer(result)) {
                    return h.image(result, "image/png");
                } else {
                    return result; // 返回错误信息字符串
                }
            });
    }

    @Tool({
        name: "send_code_image",
        description: "将代码渲染为图片并发送到当前频道。当你需要发送一段格式化代码时使用此工具",
        parameters: withInnerThoughts({
            code: Schema.string().required().description("要转换为图片的代码字符串"),
            lang: Schema.string().default("plaintext").description("代码的语言，例如 `typescript`, `python`, `json`"),
            theme: Schema.string().description(
                `代码高亮的主题。默认为插件配置。可用主题: ${randomPick(Object.keys(bundledThemes)).join(", ")}`
            ),
            fontFamily: Schema.string().description("渲染时使用的字体。默认为插件配置"),
            fontSize: Schema.number().description("字体大小。默认为插件配置"),
            padding: Schema.number().description("图片内边距。默认为插件配置"),
        }),
    })
    async sendCodeImage({
        session,
        ...options
    }: Infer<{
        code: string;
        lang?: BuiltinLanguage;
        theme?: BuiltinTheme | string;
        fontFamily?: string;
        fontSize?: number;
        padding?: number;
    }>) {
        await session.send("收到渲染指令，正在生成图片...");

        const result = await this.generateImage(options);

        if (Buffer.isBuffer(result)) {
            const messageId = await session.send(h.image(result, "image/png"));
            return messageId.length > 0
                ? Success("图片已成功发送")
                : Failed("图片生成成功，但发送失败，可能是网络问题或平台限制");
        } else {
            return Failed(`图片生成失败: ${result}`);
        }
    }

    /**
     * 创建用于 Puppeteer 渲染的完整 HTML 页面
     * @param pageOptions 页面内容和样式选项
     * @returns 完整的 HTML 字符串
     */
    private createHtmlPage(pageOptions: {
        fragment: string;
        backgroundColor: string;
        fontFamily: string;
        fontSize: number;
        padding: number;
    }): string {
        const { fragment, backgroundColor, fontFamily, fontSize, padding } = pageOptions;

        // 生成 @font-face 规则
        const fontFaceStyles = Array.from(this.localFonts.entries())
            .map(
                ([name, url]) => `@font-face {
                    font-family: "${name}";
                    src: url("file://${url}");
                }`
            )
            .join("\n");

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        ${fontFaceStyles}
        body {
            margin: 0;
            padding: 0;
            background-color: ${backgroundColor};
            width: fit-content;
            height: fit-content;
        }
        .container {
            padding: ${padding}px;
        }
        pre {
            margin: 0;
            font-family: "${fontFamily}", monospace; /* 添加 monospace 作为备用 */
            font-size: ${fontSize}px;
            line-height: 1.6;
        }
    </style>
</head>
<body>
    <div class="container">
        ${fragment}
    </div>
</body>
</html>`;
    }
}

function randomPick(array: any[], num: number = 3) {
    const shuffled = array.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, num);
}
