import { Context, sleep } from "koishi";
import { Agent as HTTPAgent, ProxyAgent, fetch as ufetch } from 'undici';
import { z } from "zod";

import { AdapterSwitcher } from "./adapters";
import { Config } from "./config";
import { INNER_THOUGHTS, REQUEST_HEARTBEAT, Success, Tool, ToolManager } from "./extensions";
import { Memory, MemoryBlock } from "./Memory";
import { MessageContext, MiddlewareManager } from "./middleware/base";
import { CheckReplyConditionMiddleware } from "./middleware/CheckReplyCondition";
import { DatabaseStorageMiddleware } from "./middleware/DatabaseStorage";
import { ErrorHandlingMiddleware } from "./middleware/ErrorHandling";
import { LLMProcessingMiddleware } from "./middleware/LLMProcessing";
import { ResponseHandlingMiddleware } from "./middleware/ResponseHandling";
import { ServiceContainer } from "./services/container";
import { ScenarioManager } from "./services/ScenarioManager";
import { IMAGE_TABLE, INTERACTION_TABLE, LAST_REPLY_TABLE, MEMORY_TABLE, Message, MESSAGE_TABLE } from "./types/model";
import { getChannelType, isEmpty } from "./utils";
import { ImageProcessor } from "./utils/imageProcessor";


export default class Agent {
    private serviceContainer: ServiceContainer;
    private ctx: Context;
    private config: Config;

    static name = 'yesimbot';

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

        ctx.on("dispose", async () => {
            try {
                const middlewareManager = this.serviceContainer.get<MiddlewareManager>("middlewareManager");
                const checkReply = middlewareManager.getMiddleware<CheckReplyConditionMiddleware>("check-reply-condition");
                checkReply.destroy();
            } catch (error) {

            }
        });
    }

    /**
     * 初始化核心服务
     */
    private initializeServices(): void {
        // 注册工具管理器
        const toolManager = ToolManager.getInstance();
        // 加载工具
        this.ctx.logger.info("[Tool] Loading tools");
        toolManager.loadExtensions(this.ctx.logger);
        this.serviceContainer.register('toolManager', toolManager);
        // 注册核心工具
        toolManager.registerTool(this.createSendMessageTool(this.config));

        // 注册适配器切换器
        const adapterSwitcher = new AdapterSwitcher(this.config.API.APIList, this.config.API.Parameters);
        this.serviceContainer.register('adapterSwitcher', adapterSwitcher);

        const imageProcessor = new ImageProcessor(this.ctx);
        this.serviceContainer.register('imageProcessor', imageProcessor);

        const scenarioManager = new ScenarioManager(this.ctx);
        this.serviceContainer.register('scenarioManager', scenarioManager);

        // 加载记忆
        const memory = Memory.getInstance(this.ctx);
        this.serviceContainer.register('memory', memory);
        this.ctx.logger.info("[Memory] Loading memory_blocks");
        if (this.config.MemorySlot.StoreFile) {
            for (const key in this.config.MemorySlot.StoreFile) {
                MemoryBlock.getOrCreate(this.ctx, key)
                    .then((memoryBlock) => {
                        if (this.config.MemorySlot.StoreFile[key])
                            memoryBlock.bindFile(this.config.MemorySlot.StoreFile[key]);
                        memory.coreMemory.set(key, memoryBlock);
                    });
            }
        }

        // 注册中间件管理器
        const middlewareManager = new MiddlewareManager();

        const proxy = this.config.API.Proxy ? new ProxyAgent(this.config.API.Proxy) : new HTTPAgent();

        const pfetch = async (input, init) => {
            init = { ...init, dispatcher: proxy };
            return await ufetch(input, init);
        };

        // 设置中间件链
        middlewareManager
            // 错误处理中间件
            .use(new ErrorHandlingMiddleware(this.ctx.logger, {
                debug: this.config.Debug.EnableDebug,
                uploadDump: this.config.Debug.UploadDump
            }))

            // 数据库存储中间件
            .use(new DatabaseStorageMiddleware(this.ctx, imageProcessor, scenarioManager))

            // 检查是否达到回复条件
            .use(new CheckReplyConditionMiddleware({
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
            }, this.ctx, adapterSwitcher))

            .use(new LLMProcessingMiddleware(
                this.serviceContainer,
                memory,
                pfetch as unknown as typeof globalThis.fetch,
                {
                    debug: this.config.Debug.EnableDebug,
                }))

            .use(new ResponseHandlingMiddleware(this.serviceContainer, middlewareManager, {
                maxRetry: this.config.ToolCall.MaxRetry,
                life: this.config.ToolCall.Life,
            }))

        this.serviceContainer.register('middlewareManager', middlewareManager);
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
                const middlewareManager = this.serviceContainer.get<MiddlewareManager>('middlewareManager');
                await middlewareManager.execute(messageContext);

                // 继续Koishi中间件链
                return next();
            } catch (error) {
                this.ctx.logger.error('Error processing message:', error);
                return next();
            }
        });
    }

    /**
     * 注册数据库表
     */
    private registerDatabases(): void {
        // 消息表
        this.ctx.model.extend(MESSAGE_TABLE, {
            messageId: "string",
            sender: "object",
            channel: "object",
            timestamp: "timestamp",
            content: "string",
        }, {
            primary: ["messageId"],
            autoInc: false,
        });

        // 交互记录表
        this.ctx.model.extend(INTERACTION_TABLE, {
            id: "string",
            emitter: "string",
            emitter_channel_id: "string",
            type: "string",
            content: "object",
            life: "integer",
            timestamp: "timestamp"
        }, {
            primary: "id"
        });

        // 记忆块表
        this.ctx.model.extend(MEMORY_TABLE, {
            id: "string",
            label: "string",
            value: "array",
            limit: "integer",
        }, {
            primary: ["id", "label"],
            autoInc: false,
        });

        // 上次回复时间表
        this.ctx.model.extend(LAST_REPLY_TABLE, {
            channelId: "string",
            timestamp: "timestamp",
        }, {
            primary: "channelId",
            autoInc: false,
        });

        // 图片表
        this.ctx.model.extend(IMAGE_TABLE, {
            id: "string",
            mimeType: "string",
            base64: "string",
            summary: "string",
            desc: "string",
            size: "integer",
            timestamp: "timestamp",
        }, {
            primary: "id",
            autoInc: false,
        })
    }

    private createSendMessageTool(config: Config) {
        return Tool({
            name: "send_message",
            description: "Sends a message to the human user.",
            parameters: z.object({
                inner_thoughts: INNER_THOUGHTS,
                messages: z.array(z.string()).describe("Message contents. Each item in the list will be sent individually to mimic human-like message splitting behavior. Keep it short."),
                channel_id: z.string().optional().describe("The ID of the channel where the message should be sent. If not provided, the message will default to the current channel."),
                request_heartbeat: REQUEST_HEARTBEAT,
            }),
            execute: async ({ messages, channel_id }, context) => {
                const { ctx, session } = context;

                let idx = 1;
                let delay = true;
                if (!channel_id) {
                    channel_id = context.session.channelId;
                }

                for await (const message of messages) {
                    if (isEmpty(message)) continue;
                    // 如果是最后一条消息，不延迟
                    if (idx++ >= messages.length) {
                        delay = false;
                    }
                    let messageIds = await session.sendQueued(message);
                    const newMessage: Message = {
                        messageId: messageIds[0],
                        sender: {
                            id: session.bot.selfId,
                            name: session.bot.user.name,
                            nick: session.bot.user.nick,
                        },
                        channel: {
                            id: channel_id,
                            type: getChannelType(channel_id),
                        },
                        timestamp: new Date(),
                        content: message,
                    }
                    await ctx.database.create(MESSAGE_TABLE, newMessage);
                    const scenarioManager: ScenarioManager = this.serviceContainer.get("scenarioManager");
                    scenarioManager.updateMessage(newMessage, session, true);
                    ctx.logger.info(`Message Sent: ${message}`);
                    if (delay && config.Bot.WordsPerSecond > 0) {
                        await sleep(message.length / config.Bot.WordsPerSecond * 1000);
                    }
                }
                return Success();
            }
        });
    }

    public async getMemory() {
        const memory = this.serviceContainer.get<Memory>('memory');
        return memory
    }
}

// const defaults = {
//     debug: false,
//     retry: 3,
//     retryDelay: 500,
//     // https://github.com/unjs/ofetch#%EF%B8%8F-auto-retry
//     retryStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504]
// };
// const createFetch = (userOptions: any = {}) => {
//     const options = Object.assign({}, defaults, userOptions);
//     const xsfetch = async (retriesLeft, input, init) => {
//         init = { ...init, dispatcher: userOptions.dispatcher }
//         const res = await ufetch(input, init);
//         if (res.ok || retriesLeft === 0 || !options.retryStatusCodes.includes(res.status))
//             return res;
//         options.debug && console.warn("[xsfetch] Failed, retrying... Times left:", retriesLeft);
//         await sleep(options.retryDelay);
//         return async () => xsfetch(retriesLeft - 1, input, init);
//     };
//     return async (input, init) => {
//         let res = await xsfetch(options.retry, input, init);
//         while (typeof res === "function")
//             res = await res();
//         return res;
//     };
// };
