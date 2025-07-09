import { ChatProvider } from "@xsai-ext/shared-providers";
import { Context } from "koishi";

import { generateText, streamText } from "@/dependencies/xsai";
import { toBoolean, truncate } from "@/shared";
import type { ChatOptions, CompletionToolCall, CompletionToolResult, GenerateTextResult, Message, StreamTextStep, Usage } from "xsai";
import { ToolDefinition } from "../extension";
import { BaseModel } from "./base-model";
import { ModelConfig } from "./config";

export interface RequestOptions {
    abortSignal?: AbortSignal;
    onStreamStart?: () => void;
    tools?: ToolDefinition[];
}

export interface IChatModel extends BaseModel {
    chat(messages: Message[], options?: RequestOptions): Promise<GenerateTextResult>;
}

export class ChatModel extends BaseModel implements IChatModel {
    private readonly customParameters: Record<string, unknown> = {};

    constructor(
        ctx: Context,
        private readonly chatProvider: ChatProvider["chat"],
        modelConfig: ModelConfig,
        private readonly fetch: typeof globalThis.fetch
    ) {
        super(ctx, modelConfig, `[聊天模型] [${modelConfig.modelId}]`);
        this.parseCustomParameters();
    }

    private parseCustomParameters(): void {
        if (!this.config.parameters.custom) return;

        for (const [key, param] of Object.entries(this.config.parameters.custom)) {
            try {
                let parsedValue: any;
                switch (param.type) {
                    case "string":
                        parsedValue = String(param.value);
                        break;
                    case "number":
                        parsedValue = Number(param.value);
                        break;
                    case "boolean":
                        parsedValue = toBoolean(param.value);
                        break;
                    case "object":
                        parsedValue = JSON.parse(param.value);
                        break;
                    default:
                        parsedValue = param.value;
                }
                this.customParameters[key] = parsedValue;
            } catch (error) {
                this.logger.warn(`[配置] ⚙️ 解析自定义参数失败 | 键: "${key}" | 错误: ${error.message}`);
            }
        }
        if (Object.keys(this.customParameters).length > 0) {
            this.logger.debug(`[配置] ⚙️ 加载自定义参数 | 参数: ${JSON.stringify(this.customParameters)}`);
        }
    }

    public async chat(messages: Message[], options: RequestOptions = {}): Promise<GenerateTextResult> {
        const useStream = this.config.parameters.stream ?? true;
        this.logger.info(`💬 开始 | 流式: ${useStream}`);
        const chatOptions: ChatOptions = this.buildChatOptions(messages, options);

        try {
            if (useStream) {
                return await this._executeStream(chatOptions, options.onStreamStart);
            } else {
                return await this._executeNonStream(chatOptions);
            }
        } catch (error) {
            this.logger.error(`💥 致命异常 | 错误: ${error.message}`, error);
            throw error;
        }
    }

    private buildChatOptions(messages: Message[], options: RequestOptions): ChatOptions {
        return {
            ...this.chatProvider(this.config.modelId),
            fetch: this.fetch,
            abortSignal: options.abortSignal,
            messages,
            // tools: options.tools,
            temperature: this.config.parameters.temperature,
            topP: this.config.parameters.topP,
            ...this.customParameters,
        };
    }

    private async _executeNonStream(chatOptions: ChatOptions): Promise<GenerateTextResult> {
        this.logger.debug("→ 非流式请求");
        const result = await generateText(chatOptions);

        if (result.toolCalls && result.toolCalls.length > 0) {
            const toolNames = result.toolCalls.map((tc: CompletionToolCall) => tc.toolName).join(", ");
            this.logger.success(`✔ 工具调用 ← 名称: ${toolNames}`);
        } else {
            this.logger.success(`✔ 文本响应 ← 内容: "${truncate(result.text, 80)}"`);
        }
        return result;
    }

    /**
     * 处理流式聊天请求，并实现打字机效果。
     * 这种实现方式可以并发处理多个流（文本、步骤），并在所有流结束后组装完整结果。
     */
    private async _executeStream(chatOptions: ChatOptions, onStreamStart?: () => void): Promise<GenerateTextResult> {
        this.logger.debug("→ 流式请求 (并发处理)");
        let streamStarted = false;

        const stime = Date.now();
        const stream = await streamText({
            ...chatOptions,
            streamOptions: {
                includeUsage: true,
            },
            onChunk: (chunk) => {
                if (!streamStarted) {
                    onStreamStart?.();
                    streamStarted = true;
                    this.logger.debug(`🌊 流式传输已开始 | 首字延迟: ${Date.now() - stime}ms`);
                    // 打印一个换行符，为打字机效果准备一个干净的起始行
                    process.stdout.write("\n");
                }
            },
        });

        // --- 并发处理流的核心逻辑 ---

        // 1. 定义用于聚合最终结果的变量
        const finalContentParts: string[] = [];
        let finalSteps: GenerateTextResult["steps"] = [];
        let finalMessages: Message[] = [];
        let finalToolCalls: CompletionToolCall[] = [];
        let finalToolResults: CompletionToolResult[] = [];
        let finalUsage: GenerateTextResult["usage"];
        let finalFinishReason: GenerateTextResult["finishReason"] = "unknown";

        // 2. 创建一个 async 函数来处理文本流 (打字机效果)
        const textProcessor = async () => {
            for await (const textPart of stream.textStream) {
                process.stdout.write(textPart); // 实时打字效果
                finalContentParts.push(textPart); // 收集文本块
            }
        };

        // 3. 创建另一个 async 函数来处理步骤流 (元数据和工具调用)
        const stepProcessor = async () => {
            for await (const step of stream.stepStream) {
                // 聚合步骤
                finalSteps.push(step as StreamTextStep & { usage: Usage });
                // 聚合工具调用
                if (step.toolCalls && step.toolCalls.length > 0) {
                    finalToolCalls.push(...step.toolCalls);
                }
                // 聚合工具结果
                if (step.toolResults && step.toolResults.length > 0) {
                    finalToolResults.push(...step.toolResults);
                }
                // 持续更新使用量，最后一次的为最终值
                // if (step.usage) {
                //     finalUsage = step.usage;
                // }
                // 从 choice 中获取最终的停止原因
                if (step.choices && step.choices.length > 0) {
                    // 通常最后一个 choice 包含最终的停止原因
                    const lastChoice = step.choices[step.choices.length - 1];
                    if (lastChoice.finishReason) {
                        finalFinishReason = lastChoice.finishReason;
                    }
                }

                // 聚合消息
                if (step.messages && step.messages.length > 0) {
                    // 通常最后一个 messages 包含最终消息列表
                    finalMessages = step.messages;
                }
            }
        };

        const chunkProcessor = async () => {
            for await (const chunk of stream.chunkStream) {
                if (chunk.usage) {
                    finalUsage = chunk.usage;
                }
            }
        };

        // 4. 使用 Promise.all 来并发执行这两个处理器
        // 这将确保我们同时监听文本和步骤，直到两个流都结束
        await Promise.all([textProcessor(), stepProcessor(), chunkProcessor()]);

        // --- 流处理结束，组装并返回结果 ---

        // 打字机效果结束后，打印一个换行符，将光标移到下一行
        process.stdout.write("\n\n");
        this.logger.debug(`🌊 流式传输完毕 | 总耗时: ${Date.now() - stime}ms`);

        // 5. 组装成一个完整的 GenerateTextResult 对象
        const finalResult: GenerateTextResult = {
            steps: finalSteps,
            messages: finalMessages,
            text: finalContentParts.join(""),
            toolCalls: finalToolCalls,
            toolResults: finalToolResults,
            usage: finalUsage,
            finishReason: finalFinishReason,
        };

        // 记录总结性日志
        if (finalResult.toolCalls && finalResult.toolCalls.length > 0) {
            const toolNames = finalResult.toolCalls.map((tc) => tc.toolName).join(", ");
            this.logger.success(`✔ 工具调用 (流) ← 名称: ${toolNames}`);
        } else {
            this.logger.success(`✔ 文本响应 (流) ← 总长度: ${finalResult.text.length}, 停止原因: ${finalResult.finishReason}`);
        }

        return finalResult;
    }
}
