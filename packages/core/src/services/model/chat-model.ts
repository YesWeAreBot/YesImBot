import { ChatProvider } from "@xsai-ext/shared-providers";
import { Context, isEmpty, Logger } from "koishi";
import type { ChatOptions, CompletionToolCall, GenerateTextResult, Message } from "xsai";

import { generateText, streamText } from "../../dependencies/xsai";
import { isNotEmpty, toBoolean } from "../../shared";
import { ToolDefinition } from "../extensions";
import { ModelConfig } from "./config";

// 运行时选项，用于控制请求行为
export interface RequestOptions {
    debug?: boolean;
    logger?: Logger;
    abortSignal?: AbortSignal;
    onStreamStart?: () => void;
    tools?: ToolDefinition[]; // 定义模型可以使用哪些工具
}

/**
 * @class ChatModel
 * @description 代表一个具体、可执行的聊天模型实例。
 * 这个类封装了与 xsai 库交互的所有细节，为上层应用提供一个统一的 `chat` 接口。
 */
export class ChatModel {
    public readonly id: string; // 模型 ID
    private readonly customParameters: Record<string, unknown> = {};
    private readonly logger: Logger;

    constructor(
        ctx: Context,
        private readonly chatProvider: ChatProvider, // xsai 提供的聊天能力接口
        private readonly modelConfig: ModelConfig, // 该模型的配置
        private readonly fetch: typeof globalThis.fetch // 支持代理的 fetch
    ) {
        this.id = this.modelConfig.modelId;
        this.logger = ctx.logger("model").extend(this.id);
        this.parseCustomParameters();
    }

    /**
     * 解析并缓存模型配置中的自定义参数。
     */
    private parseCustomParameters(): void {
        if (!this.modelConfig.parameters.custom) return;

        for (const key of Object.keys(this.modelConfig.parameters.custom)) {
            const param = this.modelConfig.parameters.custom[key];
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
                this.logger.warn(`解析自定义参数 "${key}" (值为: "${param.value}") 时出错: ${error.message}`);
            }
        }
        this.logger.debug(`已加载自定义参数: ${JSON.stringify(this.customParameters)}`);
    }

    /**
     * 执行一次聊天请求。
     * @param messages - 对话历史消息。
     * @param options - 运行时选项，如工具、日志、调试、中止信号等。
     * @returns 一个包含 LLM 响应的 Promise。
     */
    public async chat(messages: Message[], options: RequestOptions = {}): Promise<GenerateTextResult> {
        const { logger, abortSignal, onStreamStart, tools, debug } = options;
        const effectiveLogger = logger?.extend(this.id) || this.logger; // 使用传入的 logger 或实例的 logger
        const log = (message: string) => debug && effectiveLogger.info(message);

        log("开始执行聊天请求...");
        log(`模型: ${this.id}, 流式输出: ${this.modelConfig.parameters.stream ?? true}`);

        const chatOptions: ChatOptions = this.buildChatOptions(messages, {
            ...options, // 传递其他选项
            logger: effectiveLogger, // 将 logger 传递给 xsai
        });

        // 如果模型配置明确指定了 Stream，则优先使用它
        const useStream = this.modelConfig.parameters.stream;

        if (useStream) {
            return this._executeStream(chatOptions, log, onStreamStart);
        } else {
            return this._executeNonStream(chatOptions, log);
        }
    }

    /**
     * 构建传递给 xsai 的 ChatOptions 对象。
     */
    private buildChatOptions(messages: Message[], options: RequestOptions): ChatOptions {
        return {
            ...this.chatProvider.chat(this.modelConfig.modelId),
            fetch: this.fetch, // 使用支持代理的 fetch
            abortSignal: options.abortSignal,
            messages,
            tools: options.tools,

            // 应用模型配置中的参数，以及运行时传入的参数
            temperature: this.modelConfig.parameters.temperature,
            topP: this.modelConfig.parameters.topP,

            // 合并所有自定义参数
            ...this.customParameters,
        };
    }

    /**
     * 处理非流式聊天请求。
     */
    private async _executeNonStream(chatOptions: ChatOptions, log: (message: string) => void): Promise<GenerateTextResult> {
        log("使用非流式模式执行。");
        const result = await generateText(chatOptions);

        if (result.toolCalls && result.toolCalls.length > 0) {
            log(`收到工具调用请求: ${result.toolCalls.map((tc: CompletionToolCall) => tc.toolName).join(", ")}`);
        } else {
            log(`收到文本响应: ${result.text.substring(0, 100)}...`);
        }
        return result;
    }

    /**
     * 处理流式聊天请求。
     */
    private async _executeStream(
        chatOptions: ChatOptions,
        log: (message: string) => void,
        onStreamStart?: () => void
    ): Promise<GenerateTextResult> {
        log("使用流式模式执行。");
        let streamStarted = false;
        let textStreamContent = "";
        let finalResult: GenerateTextResult | null = null;

        // 用于处理分行日志的缓冲区
        let currentLineBuffer = "";

        try {
            const stream = await streamText({
                ...chatOptions,
                streamOptions: { includeUsage: true },
                onChunk: () => {
                    if (!streamStarted) {
                        onStreamStart?.(); // 调用外部提供的回调，可能用于取消重试定时器
                        streamStarted = true;
                        log("流式传输已开始。");
                    }
                },
            });

            // xsai 的 streamText 返回一个包含 textStream 和 stepStream 的对象
            const textStream: ReadableStream<string> = stream["textStream"];
            // const stepStream: ReadableStream<any> = stream["stepStream"]; // 如果需要处理工具调用等，需要解析 stepStream

            log(`正在接收来自模型 "${this.id}" 的文本流...`);

            const reader = textStream.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                if (isEmpty(value)) continue;
                textStreamContent += value;
                currentLineBuffer += value;

                // 处理分行日志
                if (currentLineBuffer.includes("\n")) {
                    const lines = currentLineBuffer.split("\n");
                    // 如果 buffer 以换行符结尾，说明是一行完整的
                    if (currentLineBuffer.endsWith("\n")) {
                        lines.forEach((line) => {
                            if (isNotEmpty(line)) log(line);
                        });
                        currentLineBuffer = "";
                    } else {
                        // 否则，最后一行是未完成的，保留到下次
                        lines.slice(0, -1).forEach((line) => {
                            if (isNotEmpty(line)) log(line);
                        });
                        currentLineBuffer = lines[lines.length - 1];
                    }
                }
            }
            // 输出最后可能未完全刷新的行
            if (isNotEmpty(currentLineBuffer)) log(currentLineBuffer);

            log(`模型 "${this.id}" 的文本流接收完毕。`);

            // 在这里可以处理 stepStream 来获取工具调用、finishReason 等信息
            // 示例：如果需要处理工具调用，需要解析 stepStream
            // for await (const step of stream["stepStream"]) { ... }
            // 最终返回的结果结构应与 GenerateTextResult 兼容

            // 对于目前的简要实现，我们只返回收集到的文本和使用情况
            finalResult = {
                text: textStreamContent,
                // usage: stream.usage, // 假设 usage 在顶层返回
                toolCalls: [], // 根据 stepStream 解析
                finishReason: "stop", // 假设默认是 stop，除非从 stepStream 获取到其他原因
            } as unknown as GenerateTextResult;

            // 如果有工具调用发生，需要更复杂的处理逻辑
            // 例如，在 streamText 的 onChunk/onStep 中捕获 tool calls

            return finalResult as GenerateTextResult; // 强制类型断言，实际可能需要更精确的类型处理
        } catch (error: any) {
            log(`流式处理过程中发生错误: ${error.message || error}`);
            throw error; // 将错误传递给上层处理
        }
    }
}
