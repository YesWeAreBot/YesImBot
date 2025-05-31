import fs from "fs/promises";
import path from "path";

import { ChatModelSwitcher } from "../adapters";
import { Memory } from "../Memory";
import { ServiceContainer } from "../services/container";
import { ScenarioManager } from "../services/ScenarioManager";
import { ConversationState, MessageContext, Middleware } from "./base";

export class LLMProcessingMiddleware implements Middleware {
    name = "llm-processing";
    private scenarioManager: ScenarioManager;
    private chatModelSwitcher: ChatModelSwitcher;

    constructor(
        private service: ServiceContainer,
        private memory: Memory,
        private config?: {
            debug?: boolean;
            abortSignal?: AbortSignal;
            slotContains: string[][];
            slotSize: number;
        }
    ) {
        this.scenarioManager = service.get<ScenarioManager>("scenarioManager");
        this.chatModelSwitcher = service.get("chatModelSwitcher");
    }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        if (ctx.state !== ConversationState.PROCESSING) {
            return await next();
        }

        try {
            const contain = this.config.slotContains.find((slot) => slot.includes(ctx.koishiSession.channelId));

            // 从 ScenarioManager 获取场景对象（可能是缓存的，也可能是新加载的）
            const currentScenario = await this.scenarioManager.getScenario(ctx.koishiSession, this.config.slotSize);

            // 处理所有与该频道相关的交互记录的生命周期
            await this.scenarioManager.processInteractions(ctx.koishiSession.channelId);

            // 构建提示词
            const systemPrompt = await this.getSystemPrompt(ctx);
            const memoryPrompt = await this.memory.render();
            const context = this.scenarioManager.render(contain);

            let retry = this.chatModelSwitcher.length;
            const initialRetryCount = retry; // 记录初始重试次数
            let lastError: any = null;

            while (retry > 0) {
                try {
                    const { model } = this.chatModelSwitcher.getModel(); // 获取当前适配器
                    if (!model) {
                        // 如果适配器切换器在还有重试次数的情况下，已经没有可用的适配器了
                        // 这可能意味着适配器列表为空，或者所有适配器都被临时禁用
                        throw new Error("[LLMProcessing] 没有可用的LLM适配器");
                    }
                    ctx.llmResponse = await model.chat(
                        [
                            { role: "system", content: systemPrompt + "\n" + memoryPrompt },
                            { role: "user", content: context },
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
                    lastError = error; // 捕获每次的错误
                    retry--; // 每次失败都减少重试次数
                    let errorMessage = `[LLMProcessing] 适配器请求失败 (${error.name}: ${error.message}).`;
                    let shouldContinueToNextAdapter = false; // 标志是否应该尝试下一个适配器
                    if (error.name === "XSAIError") {
                        // 适配器返回的特定错误，表示API可以访问，但模型或服务内部有问题（如token无效，模型不可用，内容被拒绝等）
                        errorMessage += ` 错误类型: XSAIError (适配器内部错误)。`;
                        shouldContinueToNextAdapter = true;
                    } else if (error.message && error.message.includes("fetch failed")) {
                        // 网络问题
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
                                errorMessage += ` 管道破裂。`; // 较少见，但可能发生
                                break;
                            default:
                                errorMessage += ` 未知网络错误码: ${error.cause?.code || "无"}.`;
                                break;
                        }
                        shouldContinueToNextAdapter = true;
                    } else if (error.name === "AbortError") {
                        // 请求被用户或系统显式中止
                        errorMessage += ` 请求已中止。`;
                        ctx.koishiContext.logger.info(errorMessage); // 中止通常是预期行为，用info而非warn/error
                        throw error; // 不再重试，直接抛出，因为中止不是适配器的问题
                    } else {
                        // 其他未处理的错误 (如 TypeError, RangeError, LLM返回的数据格式错误等)
                        errorMessage += ` 错误类型: 未知或未分类错误。`;
                        // 对于未知错误，为了最大化成功率，也尝试下一个适配器
                        shouldContinueToNextAdapter = true;
                    }
                    if (shouldContinueToNextAdapter) {
                        if (retry > 0) {
                            ctx.koishiContext.logger.warn(`${errorMessage} 尝试切换到下一个LLM适配器，剩余重试次数: ${retry}`);
                            continue; // 继续循环，`getAdapter()`会返回下一个适配器
                        } else {
                            // 所有重试次数耗尽，但尚未成功
                            ctx.koishiContext.logger.error(`${errorMessage} 所有LLM适配器尝试失败，不再重试。`);
                            // 此时，循环将自然结束，进入最终的 !ctx.llmResponse 检查
                        }
                    } else {
                        // 如果不应继续尝试下一个适配器（例如 AbortError），则立即抛出
                        ctx.koishiContext.logger.error(`${errorMessage} 停止重试。`);
                        throw error;
                    }
                }
            }
            // 循环结束但 ctx.llmResponse 仍为空，意味着所有尝试都失败了
            if (!ctx.llmResponse) {
                const attemptedCount = initialRetryCount - retry; // 实际尝试的次数
                ctx.koishiContext.logger.error(
                    `[LLMProcessing] 所有LLM适配器请求失败，共尝试 ${attemptedCount} 次。最后错误: \n${lastError?.name || "未知错误"}: ${
                        lastError?.message || "无错误消息"
                    }`
                );
                throw lastError;
            }
            await next();
            // LLM 成功响应后，更新该频道的最后回复时间
            await this.scenarioManager.setLastReplyTime(ctx.koishiSession.channelId);
        } catch (error) {
            if (error.name === "AbortError") {
                return;
            }
            throw error;
        }
    }

    private async getSystemPrompt(ctx: MessageContext): Promise<string> {
        let content = await fs.readFile(path.join(__dirname, "../../resources/memgpt_chat.txt"), "utf-8");
        content += [`Available functions:`,  ctx.koishiContext.toolManager.getToolPrompts()].join("\n");
        return content;
    }
}
