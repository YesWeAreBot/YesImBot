import { Context, Logger, Session } from "koishi";
import { GenerateTextResult } from "xsai";
import { DefaultPlatform, OneBotPlatform, PlatformAdapter } from "../services/PlatformAdapter";
import { AgentResponse } from "../services/worldstate/interfaces";

export class MiddlewareContext {
    /** 中间件间共享数据 */
    readonly shared: Map<string, any> = new Map();

    /** 跳过后续中间件 */
    // skip(reason?: string): void;

    /** 标记中间件执行失败 */
    // fail(error: Error, middlewareName: string): void;

    /** LLM响应和处理后的响应 */
    public llmResponses?: GenerateTextResult[];
    public processedResponse?: string[];
    public agentResponses: AgentResponse[] = [];

    public _platform: PlatformAdapter;

    public currentTurnId: string;

    /** 是否@提到机器人 */
    public isMentioned: boolean = false;

    private constructor(
        // Koishi上下文对象
        public koishiContext: Context,
        // Koishi会话对象
        public koishiSession: Session,

        public allowedChannels: string[]
    ) {
        this.isMentioned = koishiSession.stripped.atSelf;
        let platformAdapter: PlatformAdapter;
        if (koishiSession.platform === "onebot") {
            platformAdapter = new OneBotPlatform(koishiSession);
        } else {
            platformAdapter = new DefaultPlatform(koishiSession);
        }
        this._platform = platformAdapter;
    }

    public static async create(koishiContext: Context, koishiSession: Session, allowedChannels: string[]): Promise<MiddlewareContext> {
        const context = new MiddlewareContext(koishiContext, koishiSession, allowedChannels);
        await context.initializeTurn();
        return context;
    }

    private async initializeTurn(): Promise<void> {
        const turn = await this.koishiContext["yesimbot.data"].getLastTurn(this.koishiSession.platform, this.koishiSession.channelId);
        if (turn) {
            this.currentTurnId = turn.id;
        } else {
            const newTurn = await this.koishiContext["yesimbot.data"].startNewTurn(
                this.koishiSession.platform,
                this.koishiSession.channelId
            );
            this.currentTurnId = newTurn.id;
            this.koishiContext.logger.info(`[Turn] Started new turn: ${this.currentTurnId}`);
        }
    }
}

/**
 * 中间件接口
 */
export interface Middleware<TConfig = any> {
    /** 中间件唯一标识 */
    readonly id: string;
    /** 中间件名称 */
    readonly name: string;
    /** 是否启用 */
    readonly enabled: boolean;
    /** 配置对象 */
    readonly config: TConfig;

    /** 执行中间件逻辑 */
    execute(ctx: MiddlewareContext, next: () => Promise<void>): Promise<void>;

    /** 初始化中间件 */
    initialize?(): Promise<void>;

    /** 清理资源 */
    dispose?(): Promise<void>;
}

/**
 * 抽象中间件基类
 * 提供通用的中间件实现基础
 */
export abstract class BaseMiddleware<TConfig = any> implements Middleware<TConfig> {
    public readonly id: string;
    public readonly name: string;
    public readonly enabled: boolean;
    public readonly config: TConfig;

    protected readonly ctx: Context;
    protected readonly logger: Logger;

    constructor(name: string, ctx: Context, config?: TConfig) {
        this.id = `middleware.${name}`;
        this.name = name;
        this.enabled = true;
        this.ctx = ctx;
        this.logger = ctx.logger(name);
        this.config = config;
    }

    /**
     * 执行中间件逻辑
     */
    abstract execute(ctx: MiddlewareContext, next: () => Promise<void>): Promise<void>;

    /**
     * 初始化中间件
     */
    async initialize?(): Promise<void>;

    /**
     * 清理资源
     */
    async dispose?(): Promise<void>;

    /**
     * 获取共享数据
     */
    protected getShared<T>(ctx: MiddlewareContext, key: string): T | undefined {
        return ctx.shared.get(key);
    }

    /**
     * 设置共享数据
     */
    protected setShared<T>(ctx: MiddlewareContext, key: string, value: T): void {
        ctx.shared.set(key, value);
    }
}

/**
 * 中间件管道
 */
export class Pipeline {
    private middlewares: Middleware[] = [];

    public use(middleware: Middleware): void {
        this.middlewares.push(middleware);
    }

    public async execute(ctx: MiddlewareContext): Promise<void> {
        const middlewaresToExecute = [...this.middlewares];

        const dispatch = async (index: number): Promise<void> => {
            if (index >= middlewaresToExecute.length) {
                return;
            }

            const currentMiddleware = middlewaresToExecute[index];

            const next = () => dispatch(index + 1);

            await currentMiddleware.execute(ctx, next);
        };

        await dispatch(0);
    }

    /**
     * 初始化中间件
     */
    public async initialize(): Promise<void> {
        for (const middleware of this.middlewares) {
            if (middleware.initialize) {
                await middleware.initialize();
            }
        }
    }

    /**
     * 清理资源
     */
    public async dispose(): Promise<void> {
        for (const middleware of this.middlewares) {
            if (middleware.dispose) {
                await middleware.dispose();
            }
        }
    }
}
