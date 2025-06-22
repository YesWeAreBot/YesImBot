import { ChatProvider } from "@xsai-ext/shared-providers";
import { Context, Logger } from "koishi";
import { generateText, streamText, type ChatOptions, type GenerateTextResult, type Message, type ToolResult } from "xsai";

import { isEmpty, isNotEmpty, toBoolean } from "../../../shared";
import { ToolDefinition } from "../../extensions";
import { Ability, ModelConfig } from "../types";

/**
 * @interface RequestOptions
 * @description 传递给 chat 方法的运行时选项，用于控制调试、日志记录和中止操作。
 */
export interface RequestOptions {
    debug?: boolean;
    logger?: Logger;
    abortSignal?: AbortSignal;
    onStreamStart?: () => void;
    tools?: ToolDefinition[];
    toolResults?: ToolResult[];
}

/**
 * @class ChatModel
 * @description 代表一个具体、可执行的聊天模型实例。
 * 这个类封装了与 xsai 库交互的所有细节，为上层应用提供一个统一的 `chat` 接口。
 */
export class ChatModel {
    public readonly id: string;
    private readonly customParameters: Record<string, unknown> = {};

    constructor(
        private readonly chatProvider: ChatProvider,
        private readonly modelConfig: ModelConfig,
        private readonly fetch: typeof globalThis.fetch
    ) {
        this.id = this.modelConfig.ModelID;
        this.parseCustomParameters();
    }

    /**
     * 解析并缓存来自配置的自定义参数。
     * 这避免了在每次 chat 调用时重复解析。
     */
    private parseCustomParameters(): void {
        if (!this.modelConfig.CustomParameters) return;

        for (const param of this.modelConfig.CustomParameters) {
            try {
                switch (param.type) {
                    case "文本":
                        this.customParameters[param.key] = String(param.value);
                        break;
                    case "数字":
                        this.customParameters[param.key] = Number(param.value);
                        break;
                    case "布尔值":
                        this.customParameters[param.key] = toBoolean(param.value);
                        break;
                    case "JSON":
                        this.customParameters[param.key] = JSON.parse(param.value);
                        break;
                    default:
                        this.customParameters[param.key] = param.value;
                }
            } catch (error) {
                // 如果解析失败，记录一个警告，而不是让整个应用崩溃。
                console.warn(
                    `[ChatModel] Failed to parse custom parameter "${param.key}" with value "${param.value}". Error: ${error.message}`
                );
            }
        }
    }

    /**
     * 核心方法，执行一次聊天请求。
     * @param messages - 对话历史消息。
     * @param options - 运行时选项，如工具、日志等。
     * @returns 一个包含 LLM 响应的 Promise。
     */
    public async chat(messages: Message[], options: RequestOptions = {}): Promise<GenerateTextResult> {
        const chatOptions = this.buildChatOptions(messages, options);
        const logger = options.logger?.extend(this.id);
        const log = (message: string) => options.debug && logger?.info(message);

        log("Executing chat request...");
        log(`Streaming: ${this.modelConfig.Stream ?? true}`);

        if (this.modelConfig.Stream ?? true) {
            return this._executeStream(chatOptions, log, options.onStreamStart);
        } else {
            return this._executeNonStream(chatOptions, log);
        }
    }

    /**
     * 构建传递给 xsai 的通用选项对象。
     */
    private buildChatOptions(messages: Message[], options: RequestOptions): ChatOptions {
        return {
            ...this.chatProvider.chat(this.modelConfig.ModelID),
            fetch: this.fetch,
            abortSignal: options.abortSignal,
            messages,
            tools: options.tools,
            toolResults: options.toolResults,
            // 从模型配置中获取参数，如果未定义则使用合理的默认值
            temperature: this.modelConfig.Temperature ?? 0.7,
            topP: this.modelConfig.Top_P ?? 1.0,
            // 应用所有自定义参数
            ...this.customParameters,
        };
    }

    /**
     * 处理非流式聊天请求。
     */
    private async _executeNonStream(chatOptions: ChatOptions, log: (message: string) => void): Promise<GenerateTextResult> {
        log("Using non-streaming mode.");
        const result = await generateText(chatOptions);

        // 如果模型有推理能力，可以尝试在这里处理，尽管 xsai v3 倾向于在工具中处理
        if (this.modelConfig.Ability & Ability.Reasoning) {
            log(`Reasoning detected (implementation-dependent): ${result.text}`);
        }

        if (result.toolCalls && result.toolCalls.length > 0) {
            log(`Tool calls requested: ${result.toolCalls.map((t) => t.toolName).join(", ")}`);
        } else {
            log(`Response text received: ${result.text.substring(0, 100)}...`);
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
        log("Using streaming mode.");
        let streamStarted = false;
        let fullText = "";
        let finalResult: GenerateTextResult | null = null;

        let currentLineBuffer = "";
        let currentReasoningBuffer = "";

        let reasoningStreamContent = "";

        try {
            const stream = await streamText({
                ...chatOptions,
                streamOptions: { includeUsage: true },
                onChunk: () => {
                    if (!streamStarted) {
                        onStreamStart?.();
                        streamStarted = true;
                        log("Stream started.");
                    }
                },
            });

            let textStream: ReadableStream<string> = stream["textStream"];
            let textStreamContent = "";

            log(`Receiving text stream from ${this.modelConfig.ModelID}...`);

            for await (const textPart of textStream) {
                if (isEmpty(textPart)) continue;
                textStreamContent += textPart;
                currentLineBuffer += textPart;
                if (currentLineBuffer.includes("\n")) {
                    if (currentLineBuffer.endsWith("\n")) {
                        for (let line of currentLineBuffer.split("\n")) {
                            if (isNotEmpty(line)) log(line);
                        }
                        currentLineBuffer = "";
                    } else {
                        const lines = currentLineBuffer.split("\n");
                        const nextLine = lines.pop();
                        for (let line of lines) {
                            if (isNotEmpty(line)) log(line);
                        }
                        currentLineBuffer = nextLine;
                    }
                }
            }

            // 输出最后一行
            if (isNotEmpty(currentLineBuffer)) log(currentLineBuffer);
            log(`Streaming text from ${this.modelConfig.ModelID} completed.`);

            for await (const step of stream["stepStream"]) {
                if (step.finishReason == "tool_calls") {
                    function stringify(args: Record<string, unknown>): string {
                        let result = [];
                        for (let key in args) {
                            result.push(`${key}=${args[key]}`);
                        }
                        return `${result.join(", ")}`;
                    }
                    for (let executeToolResult of step.toolResults) {
                        log(`→ ${executeToolResult.toolName}(${stringify(executeToolResult.args)})`);
                        log(`← ${executeToolResult.result}`);
                    }
                    return this.chat(step.messages, chatOptions);
                } else if (step.finishReason == "stop") {
                    return {
                        ...step,
                        text: textStreamContent,
                        reasoning: reasoningStreamContent,
                    } as unknown as GenerateTextResult & { reasoning: string };
                }
            }

            if (!finalResult) {
                throw new Error("Stream finished without a 'finish' event.");
            }

            return finalResult;
        } catch (error) {
            log(`Error during streaming: ${error.message}`);
            throw error;
        }
    }
}
