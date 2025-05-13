import path from "path";
import fs from "fs/promises";
import { ConversationState, MessageContext, Middleware } from "./base";
import { AdapterSwitcher } from "../adapters";
import { ToolManager } from "../extensions";
import { Memory } from "../Memory";

export class LLMProcessingMiddleware implements Middleware {
    name = 'llm-processing';

    constructor(
        private adapterSwitcher: AdapterSwitcher,
        private toolManager: ToolManager,
        private memory: Memory,
    ) {}
    
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
            
            // 发送LLM请求
            const result = await adapter.chat([
                { role: 'system', content: systemPrompt },
                { role: 'system', content: memoryPrompt },
                { role: 'user', content: scenario.render() }
            ], null, {
                debug: true,
                logger: ctx.koishiContext.logger,
            });
            
            // 存储LLM响应
            ctx.llmResponse = result;
            
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

    async getSystemPrompt(): Promise<string> {
        let content = await fs.readFile(path.join(__dirname, "../../resources/memgpt_chat.txt"), "utf-8");
        content += [
            `Available functions:`,
            this.toolManager.getToolPrompts()
        ].join("\n");
        return content;
    }
}