import { Context, Schema, sleep } from "koishi";
import { Config } from "../config";
import ToolManager, { createTool, Success, withCommonParams } from "../extensions";
import { MiddlewareManager } from "../middleware/base";
import { PromptBuilder } from "../prompt/PromptBuilder";
import { ImageProcessor, isEmpty } from "../utils";
import { IServiceContainer, SERVICE_TOKENS } from "./ServiceContainer";

/**
 * 服务初始化器
 * 负责初始化和注册所有核心服务
 */
export class ServiceInitializer {
    constructor(private ctx: Context, private config: Config, private container: IServiceContainer) {}

    /**
     * 初始化所有服务
     */
    public async initialize(): Promise<void> {
        this.registerCoreServices();
        this.registerTools();

        this.ctx.logger.info("[ServiceInitializer] 所有服务初始化完成");
    }

    private registerCoreServices(): void {
        // 注册模型切换器
        this.container.register(SERVICE_TOKENS.CHAT_MODEL_SWITCHER, () => {
            return this.ctx["yesimbot.model"].getChatModelSwitcher(this.config.Chat.UseModel);
        });

        // 注册图片处理器
        this.container.register(SERVICE_TOKENS.IMAGE_PROCESSOR, () => {
            return new ImageProcessor(this.ctx);
        });

        // 注册 DataManager
        this.container.register(SERVICE_TOKENS.DATA_MANAGER, () => {
            return this.ctx["yesimbot.data"];
        });

        // 注册提示词构建器
        this.container.register(SERVICE_TOKENS.PROMPT_BUILDER, () => {
            return new PromptBuilder(this.ctx, this.config.PromptTemplate);
        });

        // 注册中间件管理器
        this.container.register(SERVICE_TOKENS.MIDDLEWARE_MANAGER, () => {
            return new MiddlewareManager();
        });

        // 注册外部服务引用
        this.container.register(SERVICE_TOKENS.TOOL_MANAGER, () => {
            return this.ctx["yesimbot.tool"];
        });

        this.container.register(SERVICE_TOKENS.MEMORY_SERVICE, () => {
            return this.ctx["yesimbot.memory"];
        });

        this.container.register(SERVICE_TOKENS.MODEL_SERVICE, () => {
            return this.ctx["yesimbot.model"];
        });
    }

    private registerTools(): void {
        const toolManager: ToolManager = this.container.get(SERVICE_TOKENS.TOOL_MANAGER);

        // 添加重新加载钩子
        toolManager.addReloadHook(async () => {
            this.ctx.logger.info("[ServiceInitializer] 重新注册核心工具...");
            toolManager.registerTool(this.createSendMessageTool(this.config.Chat));
            // if (!this.config.Multimodal.Enabled) {
            //     const imageProcessor = this.container.get<ImageProcessor>(SERVICE_TOKENS.IMAGE_PROCESSOR);
            //     toolManager.registerTool(this.createViewImageTool(imageProcessor, this.config.ImageViewer));
            // }
        });

        // 初始注册
        toolManager.registerTool(this.createSendMessageTool(this.config.Chat));

        // if (!this.config.Multimodal.Enabled) {
        // 	const imageProcessor = this.container.get<ImageProcessor>(SERVICE_TOKENS.IMAGE_PROCESSOR);
        // 	toolManager.registerTool(this.createViewImageTool(imageProcessor, this.config.ImageViewer));
        // }
    }

    private createSendMessageTool(config: Config["Chat"]) {
        const separator = "<sep/>";
        return createTool({
            metadata: {
                name: "send_message",
                version: "1.0.0",
                description: "Sends a message to the human user.",
            },

            parameters: withCommonParams({
                message: Schema.string().description(
                    `Message content. Use \`${separator}\` to separate sentences. Each segment will be sent individually to mimic human-like typing rhythm. Keep messages short.`
                ),
                channel_id: Schema.string().description(
                    "The ID of the channel where the message should be sent. If not provided, the message will default to the current channel."
                ),
            }),
            execute: async ({ message, channel_id }, context) => {
                const { koishiContext, koishiSession } = context;
                const messages = message
                    .split(/<\s*sep\s*\/?\s*>/i)
                    .map((seg) => seg.trim())
                    .filter((seg) => !isEmpty(seg));

                let idx = 1;
                let delay = true;
                if (!channel_id) {
                    channel_id = koishiSession.channelId;
                }

                for await (const seg of messages) {
                    if (isEmpty(seg)) continue;
                    // 如果是最后一条消息，不延迟
                    if (idx++ >= messages.length) {
                        delay = false;
                    }
                    await koishiSession.sendQueued(seg);

                    // Bot's own messages are captured as 'AgentResponse' (action + observation) in the Turn.
                    // No need to save them as separate 'message_sent' events here.

                    koishiContext.logger.info(`Message Sent: ${seg}`);
                    if (delay && config.WordsPerSecond > 0) {
                        await sleep((seg.length / config.WordsPerSecond) * 1000);
                    }
                }
                return Success();
            },
        });
    }

    private createViewImageTool(imageProcessor: ImageProcessor, config: Config["ImageViewer"]) {
        return createTool({
            metadata: {
                name: "view_image",
                description:
                    "获取聊天记录中指定图片内容的详细描述。当对话需要你理解图片内容才能做出响应时调用此工具。请在需要查看图片以回答用户问题、识别图片中的信息、或理解图片传达的场景时使用。",
            },

            parameters: withCommonParams({
                image_id: Schema.string().description("聊天记录中图片的唯一ID。"),
                query: Schema.string().description(
                    "你希望了解图片的具体内容或方面。例如：'描述图片主要内容'，'图片中有哪些文字？'，'图片中人物的表情是什么？'，'分析图片传递的情绪或场景'，'总结图片的关键信息'。请尽可能具体。如果你不指定，将提供图片的主要内容描述。"
                ),
            }),
            async execute({ image_id, query }, context) {
                const { koishiContext } = context;
                const chatModel = koishiContext["yesimbot.model"].getChatModel(config.UseModel);

                const prefix = "你是一个图像分析专家。请根据以下指令，详细分析提供的图片。";
                const suffix = "请直接输出分析结果，无需额外寒暄。避免提及你无法直接看到图片。你的回答应该简洁、信息丰富且直接回应指令。";

                const prompt = [];

                prompt.push(prefix);

                if (query === "描述图片主要内容") {
                    prompt.push("请提供图片主要内容、场景、主要物体和人物的详细描述，力求准确、客观和全面。");
                } else if (query.includes("文字") || query.includes("文本")) {
                    prompt.push("请识别图片中所有可读的文字，并列出它们。如果文字内容较长，请进行概括或截取关键信息。");
                } else if (query.includes("人物") || query.includes("脸")) {
                    prompt.push(
                        "请识别图片中的人物（如果有），描述他们的特征、衣着或表情。如果能识别出身份（名人、通用职业如医生），请指出。"
                    );
                } else if (query.includes("情绪") || query.includes("氛围")) {
                    prompt.push("请分析图片所传达的情绪、氛围或人物的表情，并解释你的判断依据。");
                } else if (query.includes("异常") || query.includes("特殊")) {
                    prompt.push("请仔细观察图片，找出其中可能存在的异常、特殊或不寻常之处，并进行描述。");
                } else if (query.includes("总结") || query.includes("关键信息")) {
                    prompt.push("请总结图片的核心内容和主要信息，突出重点。");
                } else {
                    prompt.push(`请严格根据以下要求分析图片并提供信息：'${query}'`);
                }

                prompt.push(suffix);

                try {
                    const base64 = await imageProcessor.getBase64(image_id);

                    if (!base64) {
                        return {
                            status: "failed",
                            error: `Image ${image_id} Not Found`,
                        };
                    }

                    const { text } = await chatModel.chat([
                        {
                            role: "user",
                            content: [
                                { type: "text", text: prompt.join("\n") },
                                { type: "image_url", image_url: { detail: "auto", url: base64 } },
                            ],
                        },
                    ]);

                    return {
                        status: "success",
                        result: text,
                    };
                } catch (error) {
                    return {
                        status: "failed",
                        error: `${error.name}: ${error.message}`,
                    };
                }
            },
        });
    }
}
