import { Context, Random, Session } from "koishi";

import { Failed, Success, ToolCallResult, ToolManager } from "../extensions";
import { ServiceContainer } from "../services/container";
import { ScenarioManager } from "../services/ScenarioManager";
import { Interaction, INTERACTION_TABLE } from "../types/model";
import { extractJSONFromString } from "../utils/parse-structured-output";
import { ConversationState, MessageContext, Middleware, MiddlewareManager } from "./base";
import { CheckReplyConditionMiddleware } from "./CheckReplyCondition";

export class ResponseHandlingMiddleware implements Middleware {
    name = "response-handling";

    private toolManager: ToolManager;
    private scenarioManager: ScenarioManager;

    constructor(
        private service: ServiceContainer,
        private middlewareManager: MiddlewareManager,
        private options?: { maxRetry: number; life: number; maxHeartbeat?: number }
    ) {
        this.toolManager = service.get("toolManager");
        this.scenarioManager = service.get("scenarioManager");
    }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        // 只在响应状态下执行
        if (ctx.state !== ConversationState.RESPONDING) {
            return await next();
        }

        const logger = ctx.koishiContext.logger;
        const session = ctx.koishiSession;

        // 处理LLM响应
        const { text } = ctx.llmResponse;

        let response = this.parseResponse(text);

        // 处理工具调用
        let request_heartbeat = false;
        for (const func of response) {
            let { function: functionName, params } = func;

            let channel_id = params?.channel_id;

            if (!channel_id) {
                channel_id = session.channelId;
            }

            await this.recordToolCall(ctx.koishiContext, ctx.koishiSession, func);

            const result = await this.executeToolCall(
                ctx.koishiContext,
                ctx.koishiSession,
                functionName,
                params,
                this.options?.maxRetry || 0
            );

            await this.recordToolResult(ctx.koishiContext, ctx.koishiSession, functionName, result);

            if (params.request_heartbeat) {
                request_heartbeat = true;
            }
        }

        // 如果需要继续对话
        if (request_heartbeat) {
            const maxHeartbeat = this.options?.maxHeartbeat || 5; // 默认最大5次

            if (ctx.heartbeatCount >= maxHeartbeat) {
                ctx.koishiContext.logger.warn(`[ResponseHandling] Heartbeat触发次数已达到最大限制 (${maxHeartbeat})，停止连续对话`);
            } else {
                ctx.heartbeatCount++;
                ctx.koishiContext.logger.info(`[ResponseHandling] 触发heartbeat连续对话，当前次数: ${ctx.heartbeatCount}/${maxHeartbeat}`);
                await ctx.transitionTo(ConversationState.PROCESSING);
                await this.middlewareManager.executeFrom(ctx, this.middlewareManager.findIndex("llm-processing"));
            }
        }

        // 继续处理链
        await next();

        // 处理完成后重置状态
        await ctx.transitionTo(ConversationState.IDLE);
        // 重置heartbeat计数器
        ctx.heartbeatCount = 0;
        // 释放频道处理状态
        const checkReplyMiddleware = this.middlewareManager.getMiddleware("check-reply-condition") as CheckReplyConditionMiddleware;
        checkReplyMiddleware.releaseChannelState(ctx.koishiSession.channelId);
    }

    // 解析LLM响应
    private parseResponse(text: string): { function: string; params: Record<string, unknown> }[] {
        let response: { function: string; params: Record<string, unknown> }[];
        try {
            response = extractJSONFromString(text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1), "object") as any[];
        } catch (error) {
            throw new Error(`解析响应失败: ${error.message}`);
        }
        if (!response || response.length == 0) {
            throw new Error("未解析到响应");
        }

        if (!Array.isArray(response)) {
            response = [response];
        }

        for (const func of response) {
            if (!func.function || !func.params) {
                throw new Error("响应格式错误");
            }
        }

        return response;
    }

    async executeToolCall(
        koishiContext: Context,
        koishiSession: Session,
        functionName: string,
        params: Record<string, unknown>,
        maxRetry: number
    ): Promise<ToolCallResult> {
        function stringify(args: Record<string, unknown>): string {
            let result = [];
            for (let key in args) {
                result.push(`${key}="${args[key]}"`);
            }
            return `${result.join(", ")}`;
        }
        try {
            const tool = this.toolManager.getTool(functionName);
            if (!tool) {
                return Failed(`Tool ${functionName} not found`);
            }
            const context = { koishiContext, koishiSession };
            koishiContext.logger.info(`→ ${functionName}(${stringify(params)})`);
            const result = await tool.execute(params, context);
            if (!result.success && maxRetry > 0) {
                koishiContext.logger.info(`Tool ${functionName} failed, retrying...`);
                return await this.executeToolCall(koishiContext, koishiSession, functionName, params, maxRetry - 1);
            }
            koishiContext.logger.info(`← ${result ? JSON.stringify(result) : "void"}`);
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
    private async recordToolCall(
        koishiContext: Context,
        koishiSession: Session,
        func: { function: string; params: Record<string, unknown> }
    ) {
        const newInteraction: Interaction = {
            id: Random.id(),
            emitter: koishiSession.messageId,
            emitter_channel_id: koishiSession.cid,
            type: "tool_call",
            content: JSON.stringify(func),
            life: this.options?.life || 3,
            timestamp: new Date(),
        };
        await koishiContext.database.create(INTERACTION_TABLE, newInteraction);
        await this.scenarioManager.updateInteraction(newInteraction, koishiSession, true);
    }

    // 记录工具结果
    private async recordToolResult(
        koishiContext: Context,
        koishiSession: Session,
        functionName: string,
        result: ToolCallResult
    ): Promise<void> {
        const newInteraction: Interaction = {
            id: Random.id(),
            emitter: koishiSession.messageId,
            emitter_channel_id: koishiSession.cid,
            type: "tool_result",
            content: JSON.stringify({ [functionName]: result }),
            life: this.options?.life || 3,
            timestamp: new Date(),
        };
        await koishiContext.database.create(INTERACTION_TABLE, newInteraction);
        await this.scenarioManager.updateInteraction(newInteraction, koishiSession, false);
    }
}
