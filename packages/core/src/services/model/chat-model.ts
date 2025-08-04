import type { ChatProvider } from "@xsai-ext/shared-providers";
import type { GenerateTextResult } from "@xsai/generate-text";
import type { ChatOptions, CompletionStep, CompletionToolCall, CompletionToolResult, Message } from "@xsai/shared-chat";
import { Context } from "koishi";

import { generateText, streamText } from "@/dependencies/xsai";
import { AppError, ErrorDefinitions } from "@/shared/errors";
import { JsonParser, toBoolean } from "@/shared/utils";
import { BaseModel } from "./base-model";
import { ModelAbility, ModelConfig } from "./config";

/**
 * 验证器函数的返回值
 */
export interface ValidationResult {
    /** 内容是否有效 */
    valid: boolean;
    /** 是否可以提前结束流并返回 */
    earlyExit: boolean;
    /** 解析后的数据 (可选) */
    parsedData?: any;
    /** 错误信息 (可选) */
    error?: string;
}

/**
 * 自定义验证函数
 * @param chunk - 当前收到的所有文本内容
 * @returns ValidationResult
 */
export type ContentValidator = (chunk: string) => ValidationResult;

/**
 * 传递给 chat 方法的验证选项
 */
export interface ValidationOptions {
    /** 预期的响应格式，用于选择内置验证器 */
    format?: "json";
    /** 自定义验证函数，优先级高于 format */
    validator?: ContentValidator;
}
export interface ChatRequestOptions {
    messages: Message[];
    onStreamStart?: () => void;
    validation?: ValidationOptions;
    stream?: boolean;
    temperature?: number;
    topP?: number;
    [key: string]: any;
}
export interface IChatModel extends BaseModel {
    chat(options: ChatRequestOptions, abortSignal?: AbortSignal): Promise<GenerateTextResult>;
    isVisionModel(): boolean;
}

/**
 * ChatModel 类提供了与大语言模型进行聊天交互的核心功能
 * 它封装了流式与非流式请求、参数合并、内容验证以及统一的错误处理逻辑
 */
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

    /**
     * 解析并加载模型配置文件中的自定义参数
     */
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
                // 使用更清晰的警告日志
                this.logger.warn(`解析自定义参数失败 | 键: "${key}" | 值: "${param.value}" | 错误: ${error.message}`);
            }
        }
        if (Object.keys(this.customParameters).length > 0) {
            this.logger.debug(`已加载自定义参数 | ${JSON.stringify(this.customParameters)}`);
        }
    }

    /**
     * 发起聊天请求的核心方法
     * 根据配置和运行时参数，自动选择流式或非流式处理
     */
    public async chat(options: ChatRequestOptions): Promise<GenerateTextResult> {
        // 优先级: 运行时参数 > 模型配置 > 默认值 (true)
        const useStream = options.stream ?? this.config.parameters.stream ?? true;
        const chatOptions = this.buildChatOptions(options);

        this.logger.info(`🚀 [请求开始] [${useStream ? "流式" : "非流式"}] 模型: ${this.id}`);

        try {
            if (useStream) {
                return await this._executeStream(chatOptions, options.onStreamStart, options.validation);
            } else {
                return await this._executeNonStream(chatOptions);
            }
        } catch (error) {
            // 将所有底层错误包装成统一的 AppError 并向上抛出
            this._wrapAndThrow(error, chatOptions);
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
        const { validation, onStreamStart, ...restOptions } = options;
        return {
            ...this.chatProvider(this.config.modelId),
            fetch: this.fetch,

            // 默认参数
            temperature: this.config.parameters.temperature,
            topP: this.config.parameters.topP,
            ...this.customParameters,

            // 运行时参数 (会覆盖上面的默认值)
            ...restOptions,
        };
    }

    /**
     * 执行非流式请求
     */
    private async _executeNonStream(chatOptions: ChatOptions): Promise<GenerateTextResult> {
        //this.logger.debug(`➡️ [非流式] 发送请求...`);
        const stime = Date.now();
        const result = await generateText(chatOptions);
        const duration = Date.now() - stime;

        if (result.toolCalls && result.toolCalls.length > 0) {
            const toolNames = result.toolCalls.map((tc) => tc.toolName).join(", ");
            this.logger.success(`✅ [请求成功] [非流式] 工具调用: "${toolNames}" | 耗时: ${duration}ms`);
        } else {
            this.logger.success(`✅ [请求成功] [非流式] 文本长度: ${result.text.length} | 耗时: ${duration}ms`);
        }
        return result;
    }

    /**
     * 执行流式请求，并处理实时内容验证。
     */
    private async _executeStream(
        chatOptions: ChatOptions,
        onStreamStart?: () => void,
        validation?: ValidationOptions
    ): Promise<GenerateTextResult> {
        //this.logger.debug(`➡️ [流式] 发送请求...`);
        let streamStarted = false;

        // --- 1. 选择或创建验证器 ---
        const getValidator = (): ContentValidator | null => {
            if (validation?.validator) return validation.validator;
            if (validation?.format === "json") {
                const jsonParser = new JsonParser();
                return (text: string) => {
                    const trimmedText = text.trim();
                    if (
                        (trimmedText.startsWith("{") && trimmedText.endsWith("}")) ||
                        (trimmedText.startsWith("[") && trimmedText.endsWith("]"))
                    ) {
                        const result = jsonParser.parse(trimmedText);
                        return {
                            valid: !result.error,
                            earlyExit: !result.error,
                            parsedData: result.data,
                            error: result.error,
                        };
                    }
                    return { valid: false, earlyExit: false };
                };
            }
            return null;
        };
        const validator = getValidator();

        // --- 2. 准备并启动流式处理 ---
        const stime = Date.now();
        const stream = await streamText({
            ...chatOptions,
            streamOptions: { includeUsage: true },
            onEvent: (event) => {
                if (event.type === "text-delta" && !streamStarted) {
                    onStreamStart?.();
                    streamStarted = true;
                    this.logger.debug(`🌊 流式传输已开始 | 延迟: ${Date.now() - stime}ms`);
                }
            },
        });

        // --- 3. 并发处理文本流和元数据流 ---
        const finalContentParts: string[] = [];
        let finalSteps: CompletionStep[] = [];
        let finalToolCalls: CompletionToolCall[] = [];
        let finalToolResults: CompletionToolResult[] = [];
        let finalUsage: GenerateTextResult["usage"];
        let finalFinishReason: GenerateTextResult["finishReason"] = "unknown";

        const textProcessor = async () => {
            const buffer: string[] = [];
            for await (const textPart of stream.textStream) {
                buffer.push(textPart);
                finalContentParts.push(textPart);

                if (validator) {
                    const validationResult = validator(buffer.join(""));
                    if (validationResult.valid && validationResult.earlyExit) {
                        this.logger.debug(`✅ [验证] 内容有效，提前中断流... | 耗时: ${Date.now() - stime}ms`);
                        // @ts-ignore - 尝试调用底层库的中断方法
                        if (stream.abort) stream.abort();
                        else if (chatOptions.abortSignal && chatOptions.abortSignal.aborted === false) {
                            // 通过外部传入的 AbortController 来中断
                            const controller = (chatOptions.abortSignal as any).controller;
                            if (controller) controller.abort();
                        }
                        if (validationResult.parsedData) {
                            finalContentParts.splice(0, finalContentParts.length, JSON.stringify(validationResult.parsedData));
                        }
                        return; // 提前退出循环
                    }
                }
            }
        };

        const stepProcessor = async () => {
            for await (const step of await stream.steps) {
                finalSteps.push(step);
                if (step.toolCalls?.length) finalToolCalls.push(...step.toolCalls);
                if (step.toolResults?.length) finalToolResults.push(...step.toolResults);
                if (step.usage) finalUsage = step.usage;
                if (step.finishReason) finalFinishReason = step.finishReason;
            }
        };

        try {
            await Promise.all([textProcessor(), stepProcessor()]);
        } catch (error) {
            // AbortError 是我们主动中断流时产生的预期错误，应静默处理
            if (error.name === "AbortError") {
                this.logger.debug(`🟢 [流式] 捕获到预期的 AbortError，流程正常结束。`);
            } else {
                throw error; // 重新抛出其他未预料的错误
            }
        }

        const duration = Date.now() - stime;
        this.logger.debug(`🏁 [流式] 传输完成 | 总耗时: ${duration}ms`);

        // --- 4. 对最终拼接的完整内容进行验证 ---
        const finalText = finalContentParts.join("");
        if (validator) {
            const finalValidation = validator(finalText);
            if (!finalValidation.valid) {
                const errorMsg = finalValidation.error || "格式不匹配";
                this.logger.warn(`⚠️ [验证] 最终内容验证失败 | 错误: ${errorMsg}`);
                throw new AppError(ErrorDefinitions.LLM.OUTPUT_PARSING_FAILED, {
                    context: { rawResponse: finalText, details: errorMsg },
                });
            }
        }

        // --- 5. 组装并返回最终结果 ---
        const finalResult: GenerateTextResult = {
            steps: finalSteps as CompletionStep<true>[],
            messages: [],
            text: finalText,
            toolCalls: finalToolCalls,
            toolResults: finalToolResults,
            usage: finalUsage,
            finishReason: finalFinishReason,
        };

        if (finalResult.toolCalls?.length) {
            const toolNames = finalResult.toolCalls.map((tc) => tc.toolName).join(", ");
            // this.logger.success(`✅ [请求成功] [流式] 工具调用: "${toolNames}" | 耗时: ${duration}ms`);
        } else {
            // this.logger.success(`✅ [请求成功] [流式] 文本长度: ${finalResult.text.length} | 原因: ${finalResult.finishReason} | 耗时: ${duration}ms`);
        }

        return finalResult;
    }

    /**
     * 捕获底层库抛出的原始错误，将其包装为包含丰富上下文的 AppError，然后重新抛出
     * 这是统一错误处理的核心
     */
    private _wrapAndThrow(error: any, options: ChatOptions): never {
        // 始终附加基础上下文信息
        const context = {
            modelId: this.id,
            provider: this.config.providerName,
            baseURL: options.baseURL,
            isStream: options.stream,
        };

        // 1. 如果错误已经是我们自定义的 AppError，直接附加上下文并重新抛出
        if (error instanceof AppError) {
            error.addContext(context);
            throw error;
        }

        // 2. 处理 AbortError，通常由超时引起
        if (error.name === "AbortError") {
            this.logger.error(`🛑 [错误] 请求超时 | 模型: ${this.id}`);
            throw new AppError(ErrorDefinitions.LLM.TIMEOUT, {
                cause: error,
                context,
            });
        }

        // 3. 处理来自 @xsai 库的特定错误 (XSAIError)
        if (error.name === "XSAIError" && error.response) {
            const status = error.response.status;
            context["url"] = error.response.url;
            context["httpStatus"] = status;

            let definition;
            switch (status) {
                case 400:
                    definition = ErrorDefinitions.LLM.BAD_REQUEST;
                    break;
                case 401:
                    definition = ErrorDefinitions.LLM.INVALID_API_KEY;
                    break;
                case 429:
                    definition = ErrorDefinitions.LLM.RATE_LIMIT_EXCEEDED;
                    break;
                case 500:
                case 502:
                case 503:
                case 504:
                    definition = ErrorDefinitions.LLM.PROVIDER_ERROR;
                    break;
                default:
                    definition = ErrorDefinitions.LLM.REQUEST_FAILED;
            }

            this.logger.error(`🛑 [错误] API 请求失败 | 状态码: ${status} | 模型: ${this.id}`);
            throw new AppError(definition, {
                args: [`HTTP ${status}: ${error.message}`],
                cause: error,
                context,
            });
        }

        // 4. 处理其他包含 HTTP 状态码的通用错误
        if (typeof error.status === "number") {
            this.logger.error(`🛑 [错误] HTTP 请求失败 | 状态码: ${error.status} | 模型: ${this.id}`);
            throw new AppError(ErrorDefinitions.LLM.REQUEST_FAILED, {
                args: [`API 返回状态 ${error.status}: ${error.message}`],
                cause: error,
                context: { ...context, httpStatus: error.status },
            });
        }

        if (error.message === "fetch failed") {
            this.logger.error(`🛑 [错误] 网络请求失败 | 模型: ${this.id}`);
            throw new AppError(ErrorDefinitions.NETWORK.REQUEST_FAILED, {
                cause: error,
                context,
            });
        }

        // 5. 最后的通用回退，通常是网络问题或未知错误
        this.logger.error(`🛑 [错误] 未知或网络错误 | ${error.message}`);
        throw new AppError(ErrorDefinitions.NETWORK.REQUEST_FAILED, {
            cause: error,
            context,
        });
    }
}
