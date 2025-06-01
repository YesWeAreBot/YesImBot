import { Context, Session } from "koishi";
import type { GenerateTextResult } from "xsai";

import { Scenario } from "../Scenario";

/**
 * 会话状态枚举
 * 简化为三个核心状态
 */
export enum ConversationState {
    IDLE, // 空闲状态，等待新消息触发
    PROCESSING, // 处理中状态
    RESPONDING, // 响应中状态
}

/**
 * 消息上下文
 * 在中间件链中传递的上下文对象
 */
export class MessageContext {
    // 当前会话状态
    public state: ConversationState = ConversationState.IDLE;

    // LLM响应和处理后的响应
    public llmResponse?: GenerateTextResult;
    public processedResponse?: string[];

    public isMentioned: boolean = false;

    // heartbeat触发次数计数器
    public heartbeatCount: number = 0;

    public currentScenario: Scenario;

    constructor(
        // Koishi上下文对象
        public koishiContext: Context,
        // Koishi会话对象
        public koishiSession: Session
    ) {
        this.isMentioned = koishiSession.elements.some(
            (element) => element.type === "at" && (element.attrs.id === koishiSession.bot.selfId || element.attrs.type === "all")
        );
    }

    /**
     * 转换会话状态
     */
    async transitionTo(newState: ConversationState): Promise<void> {
        this.state = newState;
    }
}

/**
 * 中间件接口
 */
export interface Middleware {
    // 中间件名称
    name: string;

    // 执行中间件
    execute(ctx: MessageContext, next: () => Promise<void>): Promise<void>;
}

/**
 * 中间件管理器
 * 负责注册和执行中间件链
 */
export class MiddlewareManager {
    // 中间件列表
    public middlewares: Middleware[] = [];

    /**
     * 注册中间件
     */
    use(middleware: Middleware): this {
        this.middlewares.push(middleware);
        return this;
    }

    /**
     * 执行中间件链
     */
    async execute(ctx: MessageContext): Promise<void> {
        await this.executeFrom(ctx, 0);
    }

    /**
     * 从指定位置开始执行中间件链
     */
    async executeFrom(ctx: MessageContext, startIndex: number): Promise<void> {
        const dispatch = async (index: number): Promise<void> => {
            if (index >= this.middlewares.length) return;
            const middleware = this.middlewares[index];
            await middleware.execute(ctx, () => dispatch(index + 1));
        };
        await dispatch(startIndex);
    }

    /**
     * 获取指定名称的中间件
     */
    public getMiddleware<T extends Middleware>(name: string): T | undefined {
        return this.middlewares.find((m) => m.name === name) as T;
    }

    public findIndex(name: string): number {
        return this.middlewares.findIndex((m) => m.name === name);
    }
}
