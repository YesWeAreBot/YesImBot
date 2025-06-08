import { Context } from "koishi";
import { ChatModelSwitcher } from "../adapters";
import { PromptBuilder } from "../prompt/PromptBuilder"; // 引入 PromptBuilder
import { ScenarioManager } from "../services/scenario/ScenarioManager";
import { ConversationState, MessageContext, Middleware } from "./base";

export class LLMProcessingMiddleware extends Middleware {
    constructor(
        protected ctx: Context,
        protected services: {
            readonly scenarioManager: ScenarioManager;
            readonly chatModelSwitcher: ChatModelSwitcher;
            readonly promptBuilder: PromptBuilder;
        },
        protected config: {
            debug?: boolean;
            abortSignal?: AbortSignal;
            slotContains: string[][];
            slotSize: number;
        }
    ) {
        super("llm-processing", ctx, services, config);
    }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        if (ctx.state !== ConversationState.PROCESSING) {
            return await next();
        }

        try {
            // 原有的 slotContains 逻辑保留
            const contain = this.config.slotContains.find((slot) => slot.includes(ctx.koishiSession.channelId));

            // 从 ScenarioManager 获取**当前** Scenario 对象。
            // 这很重要，因为 PromptBuilder 的大部分块生成器依赖于 ctx.currentScenario
            ctx.currentScenario = await this.services.scenarioManager.getScenario(ctx.koishiSession, this.config.slotSize);

            // 处理所有与该频道相关的交互记录的生命周期
            await this.services.scenarioManager.processInteractions(ctx.koishiSession.channelId);

            // 构建提示词：现在通过 PromptBuilder 来完成
            const systemPrompt = await this.services.promptBuilder.buildSystemPrompt(ctx);
            const userPrompt = await this.services.promptBuilder.buildUserPrompt(ctx);

            if (this.config.debug) {
                this.ctx.logger.debug("--- LLM System Prompt ---");
                this.ctx.logger.debug(systemPrompt);
                this.ctx.logger.debug("--- LLM User Prompt ---");
                this.ctx.logger.debug(userPrompt);
                this.ctx.logger.debug("--- End Prompts ---");
            }

            let retry = this.services.chatModelSwitcher.length;
            const initialRetryCount = retry;
            let lastError: any = null;

            while (retry > 0) {
                try {
                    const model = this.services.chatModelSwitcher.getModel();
                    if (!model) {
                        throw new Error("[LLMProcessing] 没有可用的LLM适配器");
                    }
                    ctx.llmResponse = await model.chat(
                        [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: userPrompt },
                        ],
                        null,
                        {
                            debug: this.config.debug,
                            logger: ctx.koishiContext.logger,
                            abortSignal: this.config.abortSignal,
                        }
                    );
                    await ctx.transitionTo(ConversationState.RESPONDING);
                    break; // 成功，跳出重试循环
                } catch (error: any) {
                    lastError = error;
                    retry--;
                    // [FIXED] 使用可选链安全访问 error 属性
                    let errorMessage = `[LLMProcessing] 适配器请求失败 (${error?.name || 'UnknownError'}: ${error?.message || 'No message'}).`;
                    let shouldContinueToNextAdapter = false;
                    // [FIXED] 使用可选链安全访问 error 属性
                    if (error?.name === "XSAIError") {
                        errorMessage += ` 错误类型: XSAIError (适配器内部错误)。`;
                        shouldContinueToNextAdapter = true;
                    // [FIXED] 使用可选链安全访问 error 属性
                    } else if (error?.message && error.message.includes("fetch failed")) {
                        errorMessage += ` 错误类型: 网络请求失败。`;
                        switch (error.cause?.code) {
                            case "ECONNREFUSED":
                                errorMessage += ` 拒绝连接。`;
                                break;
                            case "ECONNRESET":
                                errorMessage += ` 连接被重置。`;
                                break;
                            case "ETIMEDOUT":
                                errorMessage += ` 连接超时。`;
                                break;
                            case "ENOTFOUND":
                                errorMessage += ` 主机未找到（DNS解析失败）。`;
                                break;
                            case "EPIPE":
                                errorMessage += ` 管道破裂。`;
                                break;
                            default:
                                errorMessage += ` 未知网络错误码: ${error.cause?.code || "无"}.`;
                                break;
                        }
                        shouldContinueToNextAdapter = true;
                    // [FIXED] 使用可选链安全访问 error 属性
                    } else if (error?.name === "AbortError") {
                        errorMessage += ` 请求已中止。`;
                        ctx.koishiContext.logger.info(errorMessage);
                        throw error;
                    } else {
                        errorMessage += ` 错误类型: 未知或未分类错误。`;
                        shouldContinueToNextAdapter = true;
                    }
                    if (shouldContinueToNextAdapter) {
                        if (retry > 0) {
                            ctx.koishiContext.logger.warn(`${errorMessage} 尝试切换到下一个LLM适配器，剩余重试次数: ${retry}`);
                            continue;
                        } else {
                            ctx.koishiContext.logger.error(`${errorMessage} 所有LLM适配器尝试失败，不再重试。`);
                        }
                    } else {
                        ctx.koishiContext.logger.error(`${errorMessage} 停止重试。`);
                        throw error;
                    }
                }
            }
            if (!ctx.llmResponse) {
                const attemptedCount = initialRetryCount - retry;
                ctx.koishiContext.logger.error(
                    `[LLMProcessing] 所有LLM适配器请求失败，共尝试 ${attemptedCount} 次。最后错误: \n${lastError?.name || "未知错误"}: ${
                        lastError?.message || "无错误消息"
                    }`
                );
                // [FIXED] 抛出前检查 lastError 是否存在
                if (lastError) {
                    throw lastError;
                } else {
                    throw new Error("[LLMProcessing] 所有LLM适配器均失败，但未捕获到具体错误。");
                }
            }
            await next();
            // LLM 成功响应后，更新该频道的最后回复时间，并清理该Scenario的新消息
            await this.services.scenarioManager.setLastReplyTime(ctx.koishiSession.channelId);
            ctx.currentScenario.clearPendingMessages();
        } catch (error: any) {
            // [FIXED] 使用可选链安全访问 error 属性
            if (error?.name === "AbortError") {
                return;
            }
            throw error;
        }
    }
}
