import fs from "fs/promises";
import path from "path";

import { AdapterSwitcher } from "../adapters";
import { ToolManager } from "../extensions";
import { Memory } from "../Memory";
import { ConversationState, MessageContext, Middleware } from "./base";


export class LLMProcessingMiddleware implements Middleware {
    name = 'llm-processing';

    constructor(
        private adapterSwitcher: AdapterSwitcher,
        private toolManager: ToolManager,
        private memory: Memory,
        private xfetch: typeof globalThis.fetch,
        private config?: {
            debug?: boolean;
            abortSignal?: AbortSignal;
        }
    ) { }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        // 只在处理状态下执行
        if (ctx.state !== ConversationState.PROCESSING) {
            return await next();
        }

        try {
            // 创建场景对象
            const scenario = await ctx.getScenario();

            // 构建提示词
            const systemPrompt = await this.getSystemPrompt();
            const memoryPrompt = await this.memory.render();

            let retry = this.adapterSwitcher.length;
            let lastError: any = null;

            while (retry > 0) {
                try {
                    // 获取适配器
                    let { adapter } = this.adapterSwitcher.getAdapter();
                    if (!adapter) {
                        throw new Error('No LLM adapter available');
                    }
                    ctx.koishiContext.logger.debug(`[LLMProcessing] 使用适配器尝试请求，剩余重试次数: ${retry}`);
                    ctx.llmResponse = await adapter.chat([
                        { role: 'system', content: systemPrompt + "\n" + memoryPrompt },
                        { role: 'user', content: scenario.render() }
                    ], null, {
                        xfetch: this.xfetch,
                        debug: this.config.debug,
                        logger: ctx.koishiContext.logger,
                        abortSignal: this.config.abortSignal,
                    });
                    // 转换到响应状态
                    await ctx.transitionTo(ConversationState.RESPONDING);
                    break;
                } catch (error) {
                    lastError = error;
                    // 超时或连接重置，切换下一个 Adapter
                    if (error.name === "XSAIError" || error.cause?.code === "ECONNRESET") {
                        ctx.koishiContext.logger.warn(`[LLMProcessing] 当前适配器不可用（${error.name}: ${error.message}），尝试下一个，剩余重试次数: ${retry - 1}`);
                        retry--;
                        continue;
                    }
                    // 其他错误直接抛出
                    ctx.koishiContext.logger.error(`[LLMProcessing] 发生未处理错误: ${error.name}: ${error.message}`);
                    throw error;
                }
            }
            if (!ctx.llmResponse) {
                ctx.koishiContext.logger.error(`[LLMProcessing] 所有适配器请求失败，共尝试 ${this.adapterSwitcher.length} 次。最后错误: ${lastError?.name}: ${lastError?.message}`);
                throw new Error(`Request failed after ${this.adapterSwitcher.length} attempts. Last error: ${lastError?.name}: ${lastError?.message}`);
            }
            // 继续处理链
            await next();
        } catch (error) {
            if (error.name === 'AbortError') {
                // 请求被取消，不进行错误处理
                return;
            }
            throw error;
        }
    }

    private async getSystemPrompt(): Promise<string> {
        let content = await fs.readFile(path.join(__dirname, "../../resources/memgpt_chat.txt"), "utf-8");
        content += [
            `Available functions:`,
            this.toolManager.getToolPrompts()
        ].join("\n");
        return content;
    }
}
