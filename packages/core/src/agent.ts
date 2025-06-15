import { Context } from "koishi";
import { Config } from "./config";
import { MessageContext, MiddlewareManager } from "./middleware/base";
import { DatabaseManager } from "./services/DatabaseManager";
import { MiddlewareConfigurator } from "./services/MiddlewareConfigurator";
import { ServiceContainer } from "./services/ServiceContainer";
import { ServiceInitializer } from "./services/ServiceInitializer";

declare module "koishi" {
    interface Events {
        "scenario/clear": (channelId: string) => void;
        "scenario/clearAll": () => void;
        "channel:processing:release": (channelId: string) => void;
    }
}

/**
 * Agent 核心类
 * 负责协调各个组件，实现主要的消息处理流程
 */
export default class AgentCore {
    private ctx: Context;
    private config: Config;

    private container: ServiceContainer;
    private databaseManager: DatabaseManager;
    private serviceInitializer: ServiceInitializer;
    private middlewareConfigurator: MiddlewareConfigurator;
    private middlewareManager: MiddlewareManager;

    static readonly name = "yesimbot";
    static readonly inject = ["yesimbot.tool", "yesimbot.memory", "yesimbot.model", "yesimbot.data"];

    constructor(ctx: Context, config: Config) {
        this.ctx = ctx;
        this.config = config;

        // 初始化组件
        this.container = new ServiceContainer();
        this.databaseManager = new DatabaseManager(ctx);
        this.serviceInitializer = new ServiceInitializer(ctx, config, this.container);
        this.middlewareConfigurator = new MiddlewareConfigurator(ctx, config, this.container);

        ctx.on("ready", async () => {
            await this.initialize();
        });
    }

    /**
     * 初始化 Agent
     */
    private async initialize(): Promise<void> {
        try {
            // 1. 注册数据库
            this.databaseManager.registerTables();

            // 2. 初始化服务
            await this.serviceInitializer.initialize();

            // 3. 配置中间件
            this.middlewareManager = this.middlewareConfigurator.configure();

            // 4. 注册消息处理中间件
            this.registerMessageHandler();

            this.ctx.logger.info("[Agent] 初始化完成");
        } catch (error) {
            this.ctx.logger.error("[Agent] 初始化失败:", error);
            throw error;
        }
    }

    /**
     * 注册 Koishi 消息处理中间件
     */
    private registerMessageHandler(): void {
        this.ctx.middleware(async (session, next) => {
            try {
                const allowedChannels = this.config.ReplyCondition.Channels.find((slots) => slots.includes(session.channelId)) || [];

                if (allowedChannels.length === 0) {
                    if (this.config.Debug.EnableDebug) {
                        this.ctx.logger.info(`${session.channelId} 不在回复列表，已跳过`);
                    }
                    return next();
                }

                // 创建消息上下文
                const messageContext = new MessageContext(this.ctx, session, allowedChannels);

                // 执行中间件链
                await this.middlewareManager.execute(messageContext);

                // 继续 Koishi 中间件链
                return next();
            } catch (error) {
                this.ctx.logger.error("[Agent] 消息处理错误:", (error as Error).message);
                if (this.config.Debug.EnableDebug) {
                    this.ctx.logger.error((error as Error).stack);
                }
                return next();
            }
        });
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        this.container.dispose();
        this.ctx.logger.info("[Agent] 资源清理完成");
    }
}
