import { Context, Logger, randomId } from "koishi";
import { Failed, ToolCallResult } from "../extensions";
import { DataManager } from "../services/worldstate/DataManager";
import { Action, ActionResult, AgentResponse } from "../services/worldstate/interfaces";
import { extractJSONFromString } from "../utils/parse-structured-output";
import { ConversationState, MessageContext, Middleware, MiddlewareManager } from "./base";

interface FunctionTool {
    function: string;
    params: Record<string, unknown>;
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
    // 默认配置常量
    private static readonly DEFAULT_MAX_RETRY = 3;
    private static readonly DEFAULT_LIFE = 3;
    private static readonly DEFAULT_MAX_HEARTBEAT = 5;
    private static readonly RETRY_DELAY_MS = 1500; // 重试延迟

    private readonly logger: Logger;
    private readonly dataManager: DataManager;

    constructor(
        protected ctx: Context,
        protected services: {
            readonly middlewareManager: MiddlewareManager;
        },
        protected config: {
            maxRetry: number;
            life: number;
            maxHeartbeat?: number;
        }
    ) {
        super("response-handling", ctx, services, config);
        // 为该中间件创建一个带命名空间的 logger
        this.logger = ctx.logger("ResponseHandling");
        this.dataManager = ctx["yesimbot.data"];
    }

    /**
     * 中间件主执行函数
     */
    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        if (ctx.state !== ConversationState.RESPONDING) {
            return next();
        }

        try {
            const response = this._parseAndValidateResponse(ctx.llmResponse.text);
            if (!response) {
                this.logger.warn("LLM 响应解析失败或无效，处理中止。");
                await this._finalizeProcessing(ctx);
                return;
            }

            this._logThoughts(response.thoughts);

            // Process actions and build the agent response object
            const agentResponse = await this._processActions(ctx, response.actions, response.thoughts);
            ctx.agentResponses.push(agentResponse);

            //
            await this.dataManager.addAgentResponse(ctx.currentTurnId, agentResponse);

            if (response.request_heartbeat) {
                await this._handleHeartbeat(ctx);
            } else {
                await next();
                await this._finalizeProcessing(ctx);
            }
        } catch (error) {
            this.logger.error("在处理LLM响应时发生未知错误: %s", error.message);
            this.logger.error(error.stack);
            await this._finalizeProcessing(ctx); // 保证即使出错也能释放频道
        }
    }

    /**
     * 解析并验证 LLM 的 JSON 响应。
     * @returns 解析后的数据，如果无效则返回 null。
     */
    private _parseAndValidateResponse(text: string): OutputFormat | null {
        try {
            const jsonObjects = this._extractJson(text);
            if (!jsonObjects || jsonObjects.length === 0) {
                throw new Error("响应中未找到有效的 JSON 内容。");
            }

            // 通常我们只关心第一个有效的结构化输出
            const response = jsonObjects[0] as OutputFormat;

            // 基本的结构验证
            if (!response.thoughts || !response.actions) {
                throw new Error("JSON 结构缺少 'thoughts' 或 'actions' 字段。");
            }
            for (const action of response.actions) {
                if (!action.function || typeof action.params !== "object") {
                    throw new Error("Action 格式错误，必须包含 'function' 和 'params'。");
                }
            }
            return response;
        } catch (error) {
            this.logger.warn(`[解析失败] ${error.message}`);
            return null;
        }
    }

    /**
     * 美化并输出模型的思考过程。
     */
    private _logThoughts(thoughts: OutputFormat["thoughts"]): void {
        this.logger.info("🤔 LLM 思考过程分析:");
        this.logger.info(`  - 观察 (Observe): ${thoughts.observe}`);
        this.logger.info(`  - 推理 (Analyze): ${thoughts.analyze_infer}`);
        this.logger.info(`  - 计划 (Plan):    ${thoughts.plan}`);
    }

    /**
     * 循环处理所有工具调用，并构建一个 AgentResponse 对象。
     */
    private async _processActions(ctx: MessageContext, actions: Action[], thoughts: OutputFormat["thoughts"]): Promise<AgentResponse> {
        const observations: ActionResult[] = [];
        for (const action of actions) {
            const result = await this.executeToolCall(ctx, action.function, action.params);

            // 保存自己发送的消息
            // 先这样写，过后要改
            if (action.function == "send_message") {
                await this.ctx.database.create("channel_events", {
                    turnId: ctx.currentTurnId,
                    type: "message_sent",
                    timestamp: new Date(),
                    data: {
                        messageId: randomId(),
                        senderId: ctx.koishiSession.selfId,
                        content: action.params["message"],
                    },
                });
            }
            observations.push({
                function: action.function,
                result: result,
            });
        }

        return {
            thoughts: {
                obverse: thoughts.observe,
                analyze_infer: thoughts.analyze_infer,
                plan: thoughts.plan,
            },
            actions: actions,
            observations: observations,
        };
    }

    /**
     * 处理连续对话（Heartbeat）逻辑。
     */
    private async _handleHeartbeat(ctx: MessageContext): Promise<void> {
        const maxHeartbeat = this.config.maxHeartbeat ?? ResponseHandlingMiddleware.DEFAULT_MAX_HEARTBEAT;
        if (ctx.heartbeatCount >= maxHeartbeat) {
            this.logger.warn(`❤️ Heartbeat 已达到最大限制 (${maxHeartbeat})，对话强制结束。`);
            await this._finalizeProcessing(ctx);
            return;
        }

        ctx.heartbeatCount++;
        this.logger.info(`❤️ 触发 Heartbeat，准备进行第 ${ctx.heartbeatCount} 次连续对话...`);

        await ctx.transitionTo(ConversationState.PROCESSING);

        // 重新进入 LLM 处理流程
        const llmMiddlewareIndex = this.services.middlewareManager.findIndex("llm-processing");
        await this.services.middlewareManager.executeFrom(ctx, llmMiddlewareIndex);
    }

    /**
     * 结束处理流程，重置状态并释放频道。
     */
    private async _finalizeProcessing(ctx: MessageContext): Promise<void> {
        // 结束回合
        await this.dataManager.endTurn(ctx.currentTurnId);
        this.logger.info(`[Turn] Ended turn: ${ctx.currentTurnId}`);

        await ctx.transitionTo(ConversationState.IDLE);
        ctx.heartbeatCount = 0;
        ctx.koishiContext.emit("channel:processing:release", ctx.koishiSession.channelId);
        this.logger.info("🚦 频道状态已重置为 IDLE，处理流程结束。");
    }

    /**
     * 执行单个工具调用，包含优化的重试逻辑。
     */
    async executeToolCall(ctx: MessageContext, functionName: string, params: Record<string, unknown>): Promise<ToolCallResult> {
        const toolManager = this.ctx["yesimbot.tool"];
        const tool = toolManager.getTool(functionName);

        if (!tool) {
            this.logger.warn(`[❌ Failed] 工具 '${functionName}' 未找到。`);
            return Failed(`Tool ${functionName} not found`);
        }

        const maxRetry = this.config.maxRetry ?? ResponseHandlingMiddleware.DEFAULT_MAX_RETRY;
        let lastResult: ToolCallResult = Failed("Tool call did not execute.");

        const stringifyParams = Object.entries(params)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join(", ");

        this.logger.info(`[⚙️ Action] → 调用工具: ${functionName}(${stringifyParams})`);

        for (let attempt = 1; attempt <= maxRetry + 1; attempt++) {
            try {
                // 仅在重试时（非首次尝试）输出日志并等待
                if (attempt > 1) {
                    this.logger.info(`  - 第 ${attempt - 1}/${maxRetry} 次重试...`);
                    await new Promise((resolve) => setTimeout(resolve, ResponseHandlingMiddleware.RETRY_DELAY_MS));
                }

                lastResult = await tool.execute(params, {
                    koishiContext: ctx.koishiContext,
                    koishiSession: ctx.koishiSession,
                    platform: ctx.platform,
                });

                if (lastResult.success) {
                    this.logger.info(`[✔️ Success] ← 工具返回: ${JSON.stringify(lastResult)}`);
                    return lastResult;
                }

                // 如果失败了，检查是否允许重试
                if (!lastResult.retryable) {
                    this.logger.warn(`[❌ Failed] ← 工具执行失败且不可重试: ${lastResult.error}`);
                    return lastResult;
                }

                this.logger.warn(`[⚠️ Retryable] ← 工具执行失败，准备重试。原因: ${lastResult.error}`);
            } catch (error) {
                this.logger.error(`[❌ Error] 工具 '${functionName}' 执行时抛出异常: %s`, error.message);
                this.logger.error(error.stack);
                lastResult = Failed(`Exception during tool execution: ${error.message}`);
                // 发生异常通常不可重试
                return lastResult;
            }
        }

        this.logger.error(`[❌ Failed] ← 工具 '${functionName}' 在 ${maxRetry} 次重试后仍然失败。`);
        return lastResult;
    }

    /**
     * 从字符串中提取 JSON 对象。
     * (保持原实现，因为它处理了多种 JSON 格式)
     */
    private _extractJson(text: string): any[] {
        const results = [];
        const jsonRegex = /```json\s*([\s\S]*?)```|(\{[\s\S]*\}|\[[\s\S]*\])/g;

        let match;
        while ((match = jsonRegex.exec(text)) !== null) {
            const jsonString = match[1] ? match[1].trim() : match[2]?.trim();
            if (!jsonString) continue;

            try {
                const parsedJson = JSON.parse(jsonString);
                results.push(...(Array.isArray(parsedJson) ? parsedJson : [parsedJson]));
            } catch (e) {
                try {
                    const parsedJson = extractJSONFromString(jsonString, "object");
                    results.push(...parsedJson);
                } catch (error) {
                    this.logger.debug("无效的 JSON 候选被忽略: %s", jsonString);
                }
            }
        }
        return results;
    }
}
