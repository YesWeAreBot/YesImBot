import type { ChatProvider } from "@xsai-ext/shared-providers";
import type { GenerateTextResult } from "@xsai/generate-text";
import type { ChatOptions, CompletionStep, CompletionToolCall, CompletionToolResult, Message } from "@xsai/shared-chat";
import { Context } from "koishi";

import { generateText, streamText } from "@/dependencies/xsai";
import { toBoolean } from "@/shared/utils";
import { BaseModel } from "./base-model";
import { ModelAbility, ModelConfig } from "./config";

/**
 * Chat 方法的请求选项。
 * 包含所有必要的聊天信息和可覆盖的运行时参数。
 */
export interface ChatRequestOptions {
    /** 聊天消息列表 */
    messages: Message[];
    /** 用于中止请求的 AbortSignal */
    abortSignal?: AbortSignal;
    /** 流式传输开始时的回调 */
    onStreamStart?: () => void;
    /** 可用的工具定义 */
    // tools?: ToolDefinition[];

    // --- 可覆盖的运行时参数 ---
    /** 是否使用流式传输。如果未提供，则使用模型配置的默认值。 */
    stream?: boolean;
    /** 温度参数 */
    temperature?: number;
    /** Top-P 采样参数 */
    topP?: number;
    /** 其他任何可以传递给聊天提供程序的参数 */
    [key: string]: any;
}

export interface IChatModel extends BaseModel {
    /**
     * 发起聊天请求。
     * @param options 包含消息和所有运行时参数的对象。
     */
    chat(options: ChatRequestOptions): Promise<GenerateTextResult>;

    isVisionModel(): boolean;
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

    public isVisionModel(): boolean {
        return this.config.abilities.includes(ModelAbility.Vision);
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

    public async chat(options: ChatRequestOptions): Promise<GenerateTextResult> {
        // 优先级: 运行时参数 > 模型配置 > 默认值 (true)
        const useStream = options.stream ?? this.config.parameters.stream ?? true;
        //this.logger.info(`💬 开始 | 流式: ${useStream}`);
        const chatOptions = this.buildChatOptions(options);

        try {
            if (useStream) {
                return await this._executeStream(chatOptions, options.onStreamStart);
            } else {
                return await this._executeNonStream(chatOptions);
            }
        } catch (error) {
            // this.logger.error(`💥 致命异常 | 错误: ${error.message}`, error);
            throw error;
        }
    }

    /**
     * 构建最终传递给 @xsai/shared-chat 的选项对象。
     * 该方法实现了参数的优先级合并。
     */
    private buildChatOptions(options: ChatRequestOptions): ChatOptions {
        // 参数合并优先级 (后者覆盖前者):
        // 1. 模型配置中的基础参数 (temperature, topP)
        // 2. 模型配置中的自定义参数 (this.customParameters)
        // 3. 运行时传入的参数 (options)
        return {
            ...this.chatProvider(this.config.modelId),
            fetch: this.fetch,

            // 默认参数
            temperature: this.config.parameters.temperature,
            topP: this.config.parameters.topP,
            ...this.customParameters,

            // 运行时参数 (会覆盖上面的默认值)
            // options 中包含了 messages, abortSignal, tools 以及任何覆盖参数
            ...options,
        };
    }

    private async _executeNonStream(chatOptions: ChatOptions): Promise<GenerateTextResult> {
        this.logger.debug("→ 非流式请求");
        const result = await generateText(chatOptions);

        if (result.toolCalls && result.toolCalls.length > 0) {
            const toolNames = result.toolCalls.map((tc: CompletionToolCall) => tc.toolName).join(", ");
            // this.logger.success(`✔ 工具调用 ← 名称: ${toolNames}`);
        } else {
            // this.logger.success(`✔ 文本响应 ← 内容: "${truncate(result.text, 80)}"`);
        }
        return result;
    }

    // _executeStream 方法保持不变，因为它已经从 chatOptions 中获取所需的一切。
    private async _executeStream(chatOptions: ChatOptions, onStreamStart?: () => void): Promise<GenerateTextResult> {
        // ... (此处代码无需修改)
        // this.logger.debug("→ 流式请求 (并发处理)");
        let streamStarted = false;

        const stime = Date.now();
        const stream = await streamText({
            ...chatOptions,
            streamOptions: {
                includeUsage: true,
            },
            onEvent: (event) => {
                if (event.type === "text-delta") {
                    if (!streamStarted) {
                        if (onStreamStart) {
                            onStreamStart?.();
                        }
                        streamStarted = true;
                        this.logger.debug(`🌊 流式传输已开始 | 首字延迟: ${Date.now() - stime}ms`);
                        // 打印一个换行符，为打字机效果准备一个干净的起始行
                        //process.stdout.write("\n");
                    }
                    // 实时打字效果
                    //process.stdout.write(event.text);
                }
            },
        });

        // --- 并发处理流的核心逻辑 ---

        // 1. 定义用于聚合最终结果的变量
        const finalContentParts: string[] = [];
        let finalSteps: CompletionStep[] = [];
        let finalMessages: Message[] = [];
        let finalToolCalls: CompletionToolCall[] = [];
        let finalToolResults: CompletionToolResult[] = [];
        let finalUsage: GenerateTextResult["usage"];
        let finalFinishReason: GenerateTextResult["finishReason"] = "unknown";

        // 2. 创建一个 async 函数来处理文本流 (打字机效果)
        const textProcessor = async () => {
            for await (const textPart of stream.textStream) {
                finalContentParts.push(textPart); // 收集文本块
            }
        };

        // 3. 创建另一个 async 函数来处理步骤流 (元数据和工具调用)
        const stepProcessor = async () => {
            for await (const step of await stream.steps) {
                // 聚合步骤
                finalSteps.push(step);
                // 聚合工具调用
                if (step.toolCalls && step.toolCalls.length > 0) {
                    finalToolCalls.push(...step.toolCalls);
                }
                // 聚合工具结果
                if (step.toolResults && step.toolResults.length > 0) {
                    finalToolResults.push(...step.toolResults);
                }
                // 持续更新使用量，最后一次的为最终值
                if (step.usage) {
                    finalUsage = step.usage;
                }

                if (step.finishReason) {
                    finalFinishReason = step.finishReason;
                }
            }
        };

        // 4. 使用 Promise.all 来并发执行这两个处理器
        await Promise.all([textProcessor(), stepProcessor()]);

        // --- 流处理结束，组装并返回结果 ---

        //process.stdout.write("\n\n");
        this.logger.debug(`🌊 流式传输完毕 | 总耗时: ${Date.now() - stime}ms`);

        // 5. 组装成一个完整的 GenerateTextResult 对象
        const finalResult: GenerateTextResult = {
            steps: finalSteps as CompletionStep<true>[],
            messages: finalMessages,
            text: finalContentParts.join(""),
            toolCalls: finalToolCalls,
            toolResults: finalToolResults,
            usage: finalUsage,
            finishReason: finalFinishReason,
        };

        if (finalResult.toolCalls && finalResult.toolCalls.length > 0) {
            const toolNames = finalResult.toolCalls.map((tc) => tc.toolName).join(", ");
            // this.logger.success(`✔ 工具调用 (流) ← 名称: ${toolNames}`);
        } else {
            // this.logger.success(`✔ 文本响应 (流) ← 总长度: ${finalResult.text.length}, 停止原因: ${finalResult.finishReason}`);
        }

        return finalResult;
    }
}
