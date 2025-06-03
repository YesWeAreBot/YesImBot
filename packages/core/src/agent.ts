import { Context, sleep } from "koishi";
import { z } from "zod";

import { Config } from "./config";
import { INNER_THOUGHTS, REQUEST_HEARTBEAT, Success, Tool } from "./extensions/base";
import { MessageContext, MiddlewareManager } from "./middleware/base";
import { CheckReplyConditionMiddleware } from "./middleware/CheckReplyCondition";
import { DatabaseStorageMiddleware } from "./middleware/DatabaseStorage";
import { ErrorHandlingMiddleware } from "./middleware/ErrorHandling";
import { LLMProcessingMiddleware } from "./middleware/LLMProcessing";
import { ResponseHandlingMiddleware } from "./middleware/ResponseHandling";
import { ServiceContainer } from "./services/container";
import { ScenarioManager } from "./services/ScenarioManager";
import { IMAGE_TABLE, INTERACTION_TABLE, LAST_REPLY_TABLE, Message, MESSAGE_TABLE } from "./types/model";
import { getChannelType, isEmpty } from "./utils";
import { ImageProcessor } from "./utils/imageProcessor";

export default class Agent {
    private serviceContainer: ServiceContainer;
    private ctx: Context;
    private config: Config;

    static readonly name = "yesimbot";

    static readonly inject = ["toolManager", "memory", "ModelService", "scenario"];

    constructor(ctx: Context, config: Config) {
        this.ctx = ctx;
        this.config = config;

        ctx.on("ready", async () => {
            // 初始化服务容器
            this.serviceContainer = new ServiceContainer();

            // 注册数据库
            this.registerDatabases();

            // 初始化核心服务
            this.initializeServices();

            // 注册中间件
            this.registerMiddleware();
        });
    }

    /**
     * 初始化核心服务
     */
    private initializeServices(): void {
        // 注册模型切换器
        const chatModelSwitcher = this.ctx.ModelService.getChatModelSwitcher(this.config.Chat.UseModel);
        this.serviceContainer.register("chatModelSwitcher", chatModelSwitcher);

        const imageProcessor = new ImageProcessor(this.ctx);
        this.serviceContainer.register("imageProcessor", imageProcessor);

        // 注册核心工具
        this.ctx.toolManager.registerTool(this.createSendMessageTool(this.config));
        this.ctx.toolManager.registerTool(this.createViewImageTool(imageProcessor, this.config));

        // 注册中间件管理器
        const middlewareManager = new MiddlewareManager();

        // fetch controller
        const controller = new AbortController();

        // 设置中间件链
        middlewareManager
            // 错误处理中间件
            .use(
                new ErrorHandlingMiddleware(this.ctx.logger, {
                    debug: this.config.Debug.EnableDebug,
                    uploadDump: this.config.Debug.UploadDump,
                })
            )

            // 数据库存储中间件
            .use(new DatabaseStorageMiddleware(this.ctx, imageProcessor, this.ctx.scenario))

            // 检查是否达到回复条件
            .use(
                new CheckReplyConditionMiddleware(this.ctx, {
                    allowedChannels: this.config.MemorySlot.SlotContains,
                    testMode: this.config.Debug.TestMode,
                    atReactPossibility: this.config.MemorySlot.AtReactPossibility,
                    increaseWillingnessOn: {
                        message: this.config.MemorySlot.IncreaseWillingnessOn.Message,
                        at: this.config.MemorySlot.IncreaseWillingnessOn.At,
                    },
                    threshold: this.config.MemorySlot.Threshold,
                    messageWaitTime: this.config.MemorySlot.MessageWaitTime,
                    sameUserThreshold: this.config.MemorySlot.SameUserThreshold,
                })
            )

            .use(
                new LLMProcessingMiddleware(this.ctx, this.ctx.scenario, chatModelSwitcher, {
                    debug: this.config.Debug.EnableDebug,
                    abortSignal: controller.signal,
                    slotContains: this.config.MemorySlot.SlotContains,
                    slotSize: this.config.MemorySlot.SlotSize,
                })
            )

            .use(
                new ResponseHandlingMiddleware(this.ctx.scenario, middlewareManager, {
                    maxRetry: this.config.ToolCall.MaxRetry,
                    life: this.config.ToolCall.Life,
                    maxHeartbeat: this.config.Chat.MaxHeartbeat,
                })
            );

        this.serviceContainer.register("middlewareManager", middlewareManager);

        // 清除副作用
        this.ctx.on("dispose", () => {
            controller.abort();
            this.ctx.scenario.clearAllScenario();
            const checkReply: CheckReplyConditionMiddleware = middlewareManager.getMiddleware("check-reply-condition");
            checkReply.destroy();
        });
    }

    /**
     * 注册Koishi中间件
     */
    private registerMiddleware(): void {
        this.ctx.middleware(async (session, next) => {
            try {
                // 创建消息上下文
                const messageContext = new MessageContext(this.ctx, session);

                // 执行中间件链
                const middlewareManager = this.serviceContainer.get<MiddlewareManager>("middlewareManager");
                await middlewareManager.execute(messageContext);

                // 继续Koishi中间件链
                return next();
            } catch (error) {
                this.ctx.logger.error("Error processing message:", error);
                return next();
            }
        });
    }

    /**
     * 注册数据库表
     */
    private registerDatabases(): void {
        // 消息表
        this.ctx.model.extend(
            MESSAGE_TABLE,
            {
                messageId: "string",
                sender: "object",
                channel: "object",
                timestamp: "timestamp",
                content: "string",
            },
            {
                primary: ["messageId"],
                autoInc: false,
            }
        );

        // 交互记录表
        this.ctx.model.extend(
            INTERACTION_TABLE,
            {
                id: "string",
                emitter: "string",
                emitter_channel_id: "string",
                type: "string",
                functionName: "string",
                toolParams: "json",
                toolResult: "object",
                life: "integer",
                timestamp: "timestamp",
            },
            {
                primary: "id",
            }
        );

        // 上次回复时间表
        this.ctx.model.extend(
            LAST_REPLY_TABLE,
            {
                channelId: "string",
                timestamp: "timestamp",
            },
            {
                primary: "channelId",
                autoInc: false,
            }
        );

        // 图片表
        this.ctx.model.extend(
            IMAGE_TABLE,
            {
                id: "string",
                mimeType: "string",
                base64: "string",
                summary: "string",
                desc: "string",
                size: "integer",
                timestamp: "timestamp",
            },
            {
                primary: "id",
                autoInc: false,
            }
        );
    }

    private createSendMessageTool(config: Config) {
        return Tool({
            name: "send_message",
            description: "Sends a message to the human user.",
            parameters: z.object({
                inner_thoughts: INNER_THOUGHTS,
                messages: z
                    .array(z.string())
                    .describe(
                        "Message contents. Each item in the list will be sent individually to mimic human-like message splitting behavior. Keep it short."
                    ),
                channel_id: z
                    .string()
                    .optional()
                    .describe(
                        "The ID of the channel where the message should be sent. If not provided, the message will default to the current channel."
                    ),
                request_heartbeat: REQUEST_HEARTBEAT,
            }),
            execute: async ({ messages, channel_id }, context) => {
                const { koishiContext, koishiSession } = context;

                let idx = 1;
                let delay = true;
                if (!channel_id) {
                    channel_id = koishiSession.channelId;
                }

                for await (const message of messages) {
                    if (isEmpty(message)) continue;
                    // 如果是最后一条消息，不延迟
                    if (idx++ >= messages.length) {
                        delay = false;
                    }
                    let messageIds = await koishiSession.sendQueued(message);
                    const newMessage: Message = {
                        messageId: messageIds[0],
                        sender: {
                            id: koishiSession.bot.selfId,
                            name: koishiSession.bot.user.name,
                            nick: koishiSession.bot.user.nick,
                        },
                        channel: {
                            id: channel_id,
                            type: getChannelType(channel_id),
                        },
                        timestamp: new Date(),
                        content: message,
                    };
                    await koishiContext.database.create(MESSAGE_TABLE, newMessage);
                    this.ctx.scenario.updateMessage(newMessage, koishiSession, true);
                    koishiContext.logger.info(`Message Sent: ${message}`);
                    if (delay && config.Chat.WordsPerSecond > 0) {
                        await sleep((message.length / config.Chat.WordsPerSecond) * 1000);
                    }
                }
                return Success();
            },
        });
    }

    private createViewImageTool(imageProcessor: ImageProcessor, config: Config) {
        return Tool({
            name: "view_image",
            description:
                "获取聊天记录中指定图片内容的详细描述。当对话需要你理解图片内容才能做出响应时调用此工具。请在需要查看图片以回答用户问题、识别图片中的信息、或理解图片传达的场景时使用。",
            parameters: z.object({
                inner_thoughts: INNER_THOUGHTS,
                image_id: z.string().describe("聊天记录中图片的唯一ID。"),
                query: z
                    .string()
                    .describe(
                        "你希望了解图片的具体内容或方面。例如：'描述图片主要内容'，'图片中有哪些文字？'，'图片中人物的表情是什么？'，'分析图片传递的情绪或场景'，'总结图片的关键信息'。请尽可能具体。如果你不指定，将提供图片的主要内容描述。"
                    )
                    .optional(),
                request_heartbeat: REQUEST_HEARTBEAT,
            }),
            async execute({ image_id, query }, context) {
                const { koishiContext } = context;
                const chatModel = koishiContext.ModelService.getChatModel(config.ImageViewer.UseModel);

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
                    const { base64 } = (await imageProcessor.getImage(image_id)) || {};

                    if (!base64) {
                        return {
                            success: false,
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
                        success: true,
                        result: text,
                    };
                } catch (error) {
                    return {
                        success: false,
                        error: `${error.name}: ${error.message}`,
                    };
                }
            },
        });
    }
}
