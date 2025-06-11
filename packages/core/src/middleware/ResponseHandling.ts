import { Context, Random, Session } from "koishi";
import { Failed, ToolCallResult } from "../extensions";
import { Interaction, INTERACTION_TABLE } from "../types/model";
import { extractJSONFromString } from "../utils/parse-structured-output";
import { ConversationState, MessageContext, Middleware, MiddlewareManager } from "./base";
import { ScenarioManager } from "../services/scenario/ScenarioManager";

interface FunctionTool {
    function: string;
    params: Record<string, unknown>;
    request_heartbeat: boolean;
}

interface OutputFormat {
    thoughts: {
        observe: string;
        analyze_infer: string;
        plan: string;
    };
    actions: FunctionTool[];
    request_heartbeat: boolean;
}

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

        let response: OutputFormat;
        try {
            // 解析LLM响应中的JSON
            response = this.parseResponse(text);
        } catch (error) {
            logger.error(`[ResponseHandling] LLM响应解析失败: ${error.message}`);
            // 错误后重置状态
            await ctx.transitionTo(ConversationState.IDLE);

            // 通过事件通知释放频道状态，而不是直接调用
            ctx.koishiContext.emit("channel:processing:release", session.channelId);
            return;
        }

        const { thoughts, actions, request_heartbeat } = response;

        logger.info(`观察到：${thoughts.observe}`);
        logger.info(`分析：${thoughts.analyze_infer}`);
        logger.info(`计划：${thoughts.plan}`);

        // 处理工具调用
        for (const func of actions) {
            let { function: functionName, params, request_heartbeat } = func;

            let channel_id = params?.channel_id;
            if (!channel_id) {
                channel_id = session.channelId;
            }

            // 记录工具调用
            await this.recordToolCall(ctx.koishiContext, session, functionName, params);

            const result = await this.executeToolCall(
                ctx.koishiContext,
                ctx.koishiSession,
                functionName,
                params,
                this.config?.maxRetry || 0
            );

            // 记录工具结果
            await this.recordToolResult(ctx.koishiContext, session, functionName, result);
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

                // 重新进入 LLM 处理流程
                await this.services.middlewareManager.executeFrom(ctx, this.services.middlewareManager.findIndex("llm-processing"));
                return;
            }
        }

        // 继续处理链
        await next();

        // 处理完成后重置状态
        await ctx.transitionTo(ConversationState.IDLE);
        ctx.heartbeatCount = 0;

        // 通过事件通知释放频道状态
        ctx.koishiContext.emit("channel:processing:release", session.channelId);
    }

    // 解析LLM响应，提取函数调用信息
    private parseResponse(text: string): OutputFormat {
        let response: OutputFormat;
        let actions: FunctionTool[];
        try {
            [response] = extractJson(text.trim()) || [];
            actions = response?.actions || [];
        } catch (error) {
            throw new Error(`解析响应失败: ${error.message}`);
        }
        if (!response || actions?.length == 0) {
            throw new Error("未解析到有效的函数调用响应");
        }

        // 验证解析结果的格式
        for (const func of actions) {
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

function extractJson(text: string) {
    const results = [];
    // 匹配```json ... ```代码块 或 裸露的 {...} 或 [...] JSON结构
    // `[\s\S]*?` 匹配任意字符（包括换行）非贪婪模式
    // 可能要使用贪婪模式匹配最后一个大括号
    const jsonRegex = /```json\s*([\s\S]*?)```|(\{[\s\S]*\}|\[[\s\S]*\])/g;

    let match;
    while ((match = jsonRegex.exec(text)) !== null) {
        // 捕获组1匹配的是```json```块内部的内容
        // 捕获组2匹配的是裸露的JSON对象或数组（整个 { ... } 或 [ ... ] 字符串）
        let jsonString = match[1] ? match[1].trim() : match[2]?.trim(); // trim掉多余的空白字符
        if (!jsonString) continue;

        try {
            const parsedJson = JSON.parse(jsonString);
            // 如果是数组直接展开
            if (Array.isArray(parsedJson)) {
                results.push(...parsedJson);
            } else {
                results.push(parsedJson);
            }
        } catch (e) {
            try {
                // extractJSONFromString已经返回数组，直接展开
                const parsedJson = extractJSONFromString(jsonString, "object");
                results.push(...parsedJson);
            } catch (error) {
                console.warn("Invalid JSON candidate ignored:", jsonString, e.message);
            }
        }
    }

    return results;
}
