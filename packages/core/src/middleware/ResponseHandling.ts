import { Context, Random, Session } from "koishi";

import { ScenarioManager } from "../services/ScenarioManager";
import { Interaction, INTERACTION_TABLE } from "../types/model";
import { extractJSONFromString } from "../utils/parse-structured-output";
import { ConversationState, MessageContext, Middleware, MiddlewareManager } from "./base";
import { CheckReplyConditionMiddleware } from "./CheckReplyCondition";
import { Failed, ToolCallResult } from "../extensions";

export class ResponseHandlingMiddleware extends Middleware {
    constructor(
        protected ctx: Context,
        protected services: {
            readonly scenarioManager: ScenarioManager;
            readonly middlewareManager: MiddlewareManager;
        },
        protected config: {
            maxRetry: number;
            life: number;
            maxHeartbeat?: number;
        }
    ) {
        super("response-handling", ctx, services, config);
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

        let response: { function: string; params: Record<string, unknown> }[];
        try {
            // 解析LLM响应中的JSON，LLM通常会返回一个JSON字符串，可能嵌入在其他文本中
            response = this.parseResponse(text);
        } catch (error) {
            logger.error(`[ResponseHandling] LLM响应解析失败: ${error.message}`);
            await ctx.transitionTo(ConversationState.IDLE); // 错误后重置状态
            // 释放频道处理状态
            const checkReplyMiddleware = this.services.middlewareManager.getMiddleware(
                "check-reply-condition"
            ) as CheckReplyConditionMiddleware;
            checkReplyMiddleware.releaseChannelState(session.channelId);
            return;
        }

        let request_heartbeat = false;
        // 确保工具调用和工具结果被正确记录到 Interaction 数据中
        for (const func of response) {
            let { function: functionName, params } = func;

            let channel_id = params?.channel_id;

            if (!channel_id) {
                channel_id = session.channelId;
            }

            // 记录工具调用，使用新的 Interaction 结构
            await this.recordToolCall(ctx.koishiContext, session, functionName, params);

            const result = await this.executeToolCall(ctx.koishiContext, session, functionName, params, this.config?.maxRetry || 0);

            // 记录工具结果，使用新的 Interaction 结构
            await this.recordToolResult(ctx.koishiContext, session, functionName, result);

            if (params.request_heartbeat) {
                request_heartbeat = true;
            }
        }

        // 如果需要继续对话 (heartbeat)
        if (request_heartbeat) {
            const maxHeartbeat = this.config?.maxHeartbeat || 5;

            if (ctx.heartbeatCount >= maxHeartbeat) {
                ctx.koishiContext.logger.warn(`[ResponseHandling] Heartbeat触发次数已达到最大限制 (${maxHeartbeat})，停止连续对话`);
            } else {
                ctx.heartbeatCount++;
                ctx.koishiContext.logger.info(`[ResponseHandling] 触发heartbeat连续对话，当前次数: ${ctx.heartbeatCount}/${maxHeartbeat}`);
                await ctx.transitionTo(ConversationState.PROCESSING);
                // 重新进入 LLM 处理流程，确保 Prompt 会更新
                await this.services.middlewareManager.executeFrom(ctx, this.services.middlewareManager.findIndex("llm-processing"));
                return; // 提前返回，因为处理链将从 llm-processing 重新开始
            }
        }

        // 继续处理链
        await next();

        // 处理完成后重置状态
        await ctx.transitionTo(ConversationState.IDLE);
        // 重置heartbeat计数器
        ctx.heartbeatCount = 0;
        // 释放频道处理状态
        const checkReplyMiddleware: CheckReplyConditionMiddleware = this.services.middlewareManager.getMiddleware("check-reply-condition");
        checkReplyMiddleware.releaseChannelState(session.channelId);
    }

    // 解析LLM响应，提取函数调用信息
    private parseResponse(text: string): { function: string; params: Record<string, unknown> }[] {
        let response: { function: string; params: Record<string, unknown> }[];
        try {
            // 尝试从 LLM 的原始文本中提取 JSON 字符串
            const jsonStr = text.substring(text.indexOf("```json") + 7, text.lastIndexOf("```")) || text;
            // 进一步处理，去除可能的多余换行和空格，确保是纯净的 JSON
            response = extractJSONFromString(jsonStr.trim(), "object") as any[];
        } catch (error) {
            throw new Error(`解析响应失败: ${error.message}`);
        }
        if (!response || response.length == 0) {
            // 如果解析到的不是数组，尝试将其包装成数组
            if (!Array.isArray(response)) {
                response = [response];
            } else {
                throw new Error("未解析到有效的函数调用响应");
            }
        }

        // 验证解析结果的格式
        for (const func of response) {
            if (!func || typeof func !== "object" || !func.function || !func.params) {
                throw new Error("响应格式错误：每个函数调用必须包含 'function' 和 'params' 字段。");
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
                result.push(`${key}="${typeof args[key] === "string" ? args[key] : JSON.stringify(args[key])}"`);
            }
            return `${result.join(", ")}`;
        }
        const toolManager = koishiContext["yesimbot.tool"];
        try {
            const tool = toolManager.getTool(functionName);
            if (!tool) {
                koishiContext.logger.warn(`Tool ${functionName} not found`);
                return Failed(`Tool ${functionName} not found`);
            }
            const context = { koishiContext, koishiSession };
            koishiContext.logger.info(`→ Tool Call: ${functionName}(${stringify(params)})`);
            const result = await tool.execute(params, context);
            if (!result.success && maxRetry > 0) {
                koishiContext.logger.info(`Tool ${functionName} failed, retrying...`);
                // 递归重试
                return await this.executeToolCall(koishiContext, koishiSession, functionName, params, maxRetry - 1);
            }
            koishiContext.logger.info(`← Tool Return: ${result ? JSON.stringify(result) : "void"}`);
            return result;
        } catch (error) {
            koishiContext.logger.error(`Error executing tool ${functionName}: ${error.message}`);
            koishiContext.logger.error((error as Error).stack);
            return Failed(error.message);
        }
    }

    /**
     * 记录工具调用。
     * @param koishiContext Koishi Context
     * @param koishiSession Koishi Session
     * @param functionName 工具函数名称
     * @param params 调用参数
     */
    private async recordToolCall(
        koishiContext: Context,
        koishiSession: Session,
        functionName: string,
        params: Record<string, unknown>
    ): Promise<void> {
        const newInteraction: Interaction = {
            id: Random.id(),
            emitter: koishiSession.messageId, // 关联到触发此LLM响应的用户消息
            emitter_channel_id: koishiSession.channelId,
            type: "tool_call",
            functionName: functionName,
            toolParams: params,
            life: this.config?.life || 3, // 从配置中获取或默认3轮
            timestamp: new Date(),
        };
        await koishiContext.database.create(INTERACTION_TABLE, newInteraction);
        await this.services.scenarioManager.updateInteraction(newInteraction, koishiSession, false);
    }

    /**
     * 记录工具执行结果。
     * @param koishiContext Koishi Context
     * @param koishiSession Koishi Session
     * @param functionName 工具函数名称
     * @param result 工具执行结果
     */
    private async recordToolResult(
        koishiContext: Context,
        koishiSession: Session,
        functionName: string,
        result: ToolCallResult
    ): Promise<void> {
        // send_message 工具的结果不需要单独记录为 Interaction，因为它会直接发送消息给用户，并在 Message 表中记录
        if (functionName === "send_message") return;

        const newInteraction: Interaction = {
            id: Random.id(),
            emitter: koishiSession.messageId, // 关联到触发此LLM响应的用户消息
            emitter_channel_id: koishiSession.channelId,
            type: "tool_result",
            functionName: functionName,
            toolResult: result,
            life: this.config?.life || 3, // 从配置中获取或默认3轮
            timestamp: new Date(),
        };
        await koishiContext.database.create(INTERACTION_TABLE, newInteraction);
        await this.services.scenarioManager.updateInteraction(newInteraction, koishiSession, true);
    }
}
