import fs from "fs/promises";
import path from "path";
import type { GenerateTextResult, Message, ToolResult } from "xsai";

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
        private config?: {
            maxRetry: number;
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

            // 获取适配器
            const { adapter } = this.adapterSwitcher.getAdapter();
            if (!adapter) {
                throw new Error('No LLM adapter available');
            }

            // 构建提示词
            const systemPrompt = await this.getSystemPrompt();
            const memoryPrompt = await this.memory.render();

            let retryCount = 0; // 当前重试次数

            while (retryCount < this.config?.maxRetry || 1) {
                try {
                    // 发送LLM请求
                    ctx.llmResponse = await adapter.chat([
                        { role: 'system', content: systemPrompt },
                        { role: 'system', content: memoryPrompt },
                        { role: 'user', content: scenario.render() }
                    ], null, {
                        debug: true,
                        logger: ctx.koishiContext.logger,
                    });
                } catch (error) {
                    retryCount++; // 重试次数加1
                    if (retryCount >= this.config?.maxRetry || 1) {
                        throw error; // 达到最大重试次数，抛出错误
                    }
                }
            }

            // 转换到响应状态
            await ctx.transitionTo(ConversationState.RESPONDING);

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