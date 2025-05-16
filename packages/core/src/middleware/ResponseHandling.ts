import { Context, Random, Session } from "koishi";

import { Agent } from "../agent";
import { Failed, Success, ToolCallResult, ToolManager } from "../extensions";
import { extractJSONFromString } from "../utils/parse-structured-output";
import { ConversationState, MessageContext, Middleware, MiddlewareManager } from "./base";
import { CheckReplyConditionMiddleware } from "./CheckReplyCondition";


export class ResponseHandlingMiddleware implements Middleware {
    name = 'response-handling';

    constructor(
        private middlewareManager: MiddlewareManager,
        private toolManager: ToolManager,
    ) { }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        // 只在响应状态下执行
        if (ctx.state !== ConversationState.RESPONDING) {
            return await next();
        }

        const logger = ctx.koishiContext.logger;
        const session = ctx.koishiSession;

        // 处理LLM响应
        const { text } = ctx.llmResponse;

        let response;

        try {
            response = this.parseResponse(text);
        } catch (error) {
            logger.error(error.message);
            return await next();
        }

        // 处理工具调用
        let request_heartbeat = false;
        for (const func of response) {
            let { function: functionName, params } = func;

            let channel_id = params?.channel_id;

            if (!channel_id) {
                channel_id = session.channelId;
            }

            await this.recordToolCall(ctx.koishiContext, ctx.koishiSession, func)

            const result = await this.executeToolCall(ctx.koishiContext, ctx.koishiSession, functionName, params);

            await this.recordToolResult(ctx.koishiContext, ctx.koishiSession, functionName, result);

            if (params.request_heartbeat) {
                request_heartbeat = true;
            }
        }

        // 如果需要继续对话
        if (request_heartbeat) {
            await ctx.transitionTo(ConversationState.PROCESSING);
            await this.middlewareManager.executeFrom(ctx, this.middlewareManager.findIndex("llm-processing"));
        }

        // 继续处理链
        await next();

        // 处理完成后重置状态
        await ctx.transitionTo(ConversationState.IDLE);
        // 释放频道处理状态
        const checkReplyMiddleware = this.middlewareManager.getMiddleware('check-reply-condition') as CheckReplyConditionMiddleware;
        if (!checkReplyMiddleware) {
            throw new Error("[Agent] 未找到CheckReplyConditionMiddleware");
        }
        checkReplyMiddleware.releaseChannelState(ctx.koishiSession.channelId);
    }

    // 解析LLM响应
    private parseResponse(text: string): { function: string; params: Record<string, unknown> }[] {
        let response: { function: string; params: Record<string, unknown> }[];
        try {
            response = extractJSONFromString(text, "object") as any[];
        } catch (error) {
            throw new Error(`[Agent] 解析响应失败: ${error.message}`);
        }
        if (!response || response.length == 0) {
            throw new Error("[Agent] 未解析到响应");
        }

        if (!Array.isArray(response)) {
            response = [response];
        }

        for (const func of response) {
            if (!func.function || !func.params) {
                throw new Error("[Agent] 响应格式错误");
            }
        }

        return response
    }

    async executeToolCall(koishiContext: Context, koishiSession: Session, functionName: string, params: Record<string, unknown>,): Promise<ToolCallResult> {
        function stringify(args: Record<string, unknown>): string {
            let result = [];
            for (let key in args) {
                result.push(`${key}="${args[key]}"`);
            }
            return `${result.join(', ')}`;
        }
        try {
            const tool = this.toolManager.getTool(functionName);
            if (!tool) {
                return Failed(`Tool ${functionName} not found`);
            }
            const context = { session: koishiSession, ctx: koishiContext };
            koishiContext.logger.info(`→ ${functionName}(${stringify(params)})`)
            const result = await tool.execute(params, context);
            koishiContext.logger.info(`← ${result ? JSON.stringify(result) : "void"}`)
            if (result instanceof String) {
                return Success(result);
            }
            if (result.success) {
                return Success(result.result);
            } else {
                return Failed(result.error);
            }
        } catch (error) {
            return Failed(error.message);
        }
    }

    // 记录工具调用
    private async recordToolCall(koishiContext: Context, koishiSession: Session, func: { function: string; params: Record<string, unknown> }) {
        await koishiContext.database.create(Agent.INTERACTION_TABLE, {
            id: Random.id(),
            emitter: koishiSession.messageId,
            type: "tool_call",
            content: JSON.stringify(func),
            life: 3,
            timestamp: new Date()
        });
    }

    // 记录工具结果
    private async recordToolResult(koishiContext: Context, koishiSession: Session, functionName: string, result: ToolCallResult): Promise<void> {
        await koishiContext.database.create(Agent.INTERACTION_TABLE, {
            id: Random.id(),
            emitter: koishiSession.messageId,
            type: "tool_result",
            content: JSON.stringify({ [functionName]: result }),
            life: 3,
            timestamp: new Date()
        });
    }
}