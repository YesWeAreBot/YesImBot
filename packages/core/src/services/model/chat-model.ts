import type { ChatProvider } from "@xsai-ext/shared-providers";
import type { GenerateTextResult } from "@xsai/generate-text";
import type { ChatOptions, CompletionStep, CompletionToolCall, CompletionToolResult, Message } from "@xsai/shared-chat";
import { Context } from "koishi";

import { generateText, streamText } from "@/dependencies/xsai";
import { AppError, ErrorDefinitions } from "@/shared/errors";
import { isEmpty, isNotEmpty, JsonParser, toBoolean } from "@/shared/utils";
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
export type ContentValidator = (chunk: string, final?: boolean) => ValidationResult;

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
    abortSignal?: AbortSignal;
    onStreamStart?: () => void;
    validation?: ValidationOptions;
    messages: Message[];
    stream?: boolean;
    temperature?: number;
    topP?: number;
    [key: string]: any;
}
export interface IChatModel extends BaseModel {
    chat(options: ChatRequestOptions): Promise<GenerateTextResult>;
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
            return useStream
                ? await this._executeStream(chatOptions, options.onStreamStart, options.validation)
                : await this._executeNonStream(chatOptions);
        } catch (error) {
            await this._wrapAndThrow(error, chatOptions);
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
        const { validation, onStreamStart, abortSignal, ...restOptions } = options;
        return {
            ...this.chatProvider(this.config.modelId),
            fetch: async (url: string, init: RequestInit) => {
                init.signal = options.abortSignal;
                return this.fetch(url, init);
            },

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
        const stime = Date.now();
        const result = await generateText(chatOptions);
        const duration = Date.now() - stime;

        const logMessage = result.toolCalls?.length
            ? `工具调用: "${result.toolCalls.map((tc) => tc.toolName).join(", ")}"`
            : `文本长度: ${result.text.length}`;
        this.logger.success(`✅ [请求成功] [非流式] ${logMessage} | 耗时: ${duration}ms`);
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
        const stime = Date.now();
        let streamStarted = false;
        const validator = this._getValidator(validation);

        const finalContentParts: string[] = [];
        let finalSteps: CompletionStep[] = [];
        let finalToolCalls: CompletionToolCall[] = [];
        let finalToolResults: CompletionToolResult[] = [];
        let finalUsage: GenerateTextResult["usage"];
        let finalFinishReason: GenerateTextResult["finishReason"] = "unknown";

        let streamFinished = false;

        try {
            const buffer: string[] = [];
            const stream = await streamText({
                ...chatOptions,
                streamOptions: { includeUsage: true },
                onEvent: (event) => {
                    if (event.type !== "text-delta" || streamFinished) return;

                    const textDelta = event.text || "";
                    if (!streamStarted && isNotEmpty(textDelta)) {
                        onStreamStart?.();
                        streamStarted = true;
                        this.logger.debug(`🌊 流式传输已开始 | 延迟: ${Date.now() - stime}ms`);
                    }

                    if (textDelta === "") return;

                    buffer.push(textDelta);
                    finalContentParts.push(textDelta);

                    if (validator) {
                        const validationResult = validator(buffer.join(""));
                        if (validationResult.valid && validationResult.earlyExit) {
                            this.logger.debug(`✅ 内容有效，提前中断流... | 耗时: ${Date.now() - stime}ms`);
                            streamFinished = true;
                            // 使用解析后的干净数据替换部分流式文本
                            if (validationResult.parsedData) {
                                finalContentParts.splice(0, finalContentParts.length, JSON.stringify(validationResult.parsedData));
                            }
                            // 触发 AbortController 来中断HTTP连接
                            const controller = (chatOptions.abortSignal as any)?.controller;
                            if (controller) controller.abort("early_exit");
                        }
                    }
                },
            });

            // 仅等待元数据（如 usage, finishReason）处理完成
            // 文本部分已在 onEvent 中实时处理
            await (async () => {
                for await (const step of await stream.steps) {
                    finalSteps.push(step);
                    if (step.toolCalls?.length) finalToolCalls.push(...step.toolCalls);
                    if (step.toolResults?.length) finalToolResults.push(...step.toolResults);
                    if (step.usage) finalUsage = step.usage;
                    if (step.finishReason) finalFinishReason = step.finishReason;
                }
            })();
        } catch (error) {
            // "early_exit" 是我们主动中断流时产生的预期错误，应静默处理
            if (error.name === "AbortError" && error.message === "early_exit") {
                this.logger.debug(`🟢 [流式] 捕获到预期的 AbortError，流程正常结束。`);
            } else {
                throw error; // 重新抛出其他未预料的错误
            }
        }

        const duration = Date.now() - stime;
        const finalText = finalContentParts.join("");

        if (isEmpty(finalText)) {
            this.logger.warn(`💬 [流式] 模型未输出有效内容`);
            throw new AppError(ErrorDefinitions.LLM.OUTPUT_PARSING_FAILED, {
                context: { rawResponse: finalText, details: "模型未输出有效内容" },
            });
        }

        this.logger.debug(
            `🏁 [流式] 传输完成 | 总耗时: ${duration}ms | 输入: ${finalUsage?.prompt_tokens || "N/A"} | 输出: ${finalUsage?.completion_tokens || `~${finalText.length / 4}`}`
        );

        // 对最终拼接的完整内容进行最后一次验证
        if (validator) {
            const finalValidation = validator(finalText, true);
            if (!finalValidation.valid) {
                const errorMsg = finalValidation.error || "格式不匹配或模型未输出有效内容";
                this.logger.warn(`⚠️ 最终内容验证失败 | 错误: ${errorMsg}`);
                throw new AppError(ErrorDefinitions.LLM.OUTPUT_PARSING_FAILED, {
                    context: { rawResponse: finalText, details: errorMsg },
                });
            }
        }

        return {
            steps: finalSteps as CompletionStep<true>[],
            messages: [],
            text: finalText,
            toolCalls: finalToolCalls,
            toolResults: finalToolResults,
            usage: finalUsage,
            finishReason: finalFinishReason,
        };
    }

    private _getValidator(validation?: ValidationOptions): ContentValidator | null {
        if (validation?.validator) return validation.validator;
        if (validation?.format === "json") {
            const jsonParser = new JsonParser();
            return (text: string, final?: boolean) => {
                const trimmedText = text.trim();
                // 简单的完整性检查
                if (
                    (trimmedText.startsWith("{") && trimmedText.endsWith("}")) ||
                    (trimmedText.startsWith("[") && trimmedText.endsWith("]"))
                ) {
                    const result = jsonParser.parse(trimmedText);
                    return { valid: !result.error, earlyExit: !result.error, parsedData: result.data, error: result.error as string };
                }
                // 如果是流的最后，但格式仍不完整，则判定为无效
                if (final) return { valid: false, earlyExit: false, error: "Incomplete JSON" };
                return { valid: false, earlyExit: false };
            };
        }
        return null;
    }

    private async _wrapAndThrow(error: any, options: ChatOptions): Promise<never> {
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
        if (error.name === "AbortError" || error.message === "timeout") {
            const duration = error.duration ? ` (${error.duration}s)` : "";
            this.logger.error(`🛑 [错误] 请求超时${duration} | 模型: ${this.id}`);
            throw new AppError(ErrorDefinitions.LLM.TIMEOUT, { cause: error, context });
        }

        if (error.name === "XSAIError" && error.response) {
            const { status, url } = error.response;
            context["url"] = url;
            context["httpStatus"] = status;

            let definition;
            if (status === 401) definition = ErrorDefinitions.LLM.INVALID_API_KEY;
            else if (status === 429) definition = ErrorDefinitions.LLM.RATE_LIMIT_EXCEEDED;
            else if (status >= 500) definition = ErrorDefinitions.LLM.PROVIDER_ERROR;
            else definition = ErrorDefinitions.LLM.REQUEST_FAILED;

            this.logger.error(`🛑 [错误] API 请求失败 | 状态码: ${status} | 模型: ${this.id}`);
            throw new AppError(definition, { args: [`HTTP ${status}: ${error.message}`], cause: error, context });
        }

        if (error.message === "fetch failed") {
            this.logger.error(`🛑 [错误] 网络请求失败 (fetch failed) | 模型: ${this.id}`);
            throw new AppError(ErrorDefinitions.NETWORK.REQUEST_FAILED, { cause: error, context });
        }

        this.logger.error(`🛑 [错误] 未知或网络错误 | ${error.message}`);
        throw new AppError(ErrorDefinitions.NETWORK.REQUEST_FAILED, { cause: error, context });
    }
}
