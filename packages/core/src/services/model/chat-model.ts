import type { ChatProvider } from "@xsai-ext/shared-providers";
import type { GenerateTextResult } from "@xsai/generate-text";
import type { ChatOptions, CompletionStep, CompletionToolCall, CompletionToolResult, Message } from "@xsai/shared-chat";
import { Context } from "koishi";

import { generateText, streamText } from "@/dependencies/xsai";
import { isEmpty, isNotEmpty, JsonParser, toBoolean } from "@/shared/utils";
import { BaseModel } from "./base-model";
import { ChatModelConfig, ModelAbility, ModelConfig } from "./config";

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
    config: ChatModelConfig;
    chat(options: ChatRequestOptions): Promise<GenerateTextResult>;
    isVisionModel(): boolean;
}

export class ChatModel extends BaseModel implements IChatModel {
    declare public readonly config: ChatModelConfig;
    private readonly customParameters: Record<string, unknown> = {};
    constructor(
        ctx: Context,
        private readonly providerName: string,
        private readonly chatProvider: ChatProvider["chat"],
        modelConfig: ChatModelConfig,
        private readonly fetch: typeof globalThis.fetch
    ) {
        super(ctx, modelConfig);
        this.parseCustomParameters();
    }

    public isVisionModel(): boolean {
        return this.config.abilities.includes(ModelAbility.Vision);
    }

    private parseCustomParameters(): void {
        if (!this.config.custom) return;
        for (const item of this.config.custom) {
            try {
                let parsedValue: any;
                switch (item.type) {
                    case "string":
                        parsedValue = String(item.value);
                        break;
                    case "number":
                        parsedValue = Number(item.value);
                        break;
                    case "boolean":
                        parsedValue = toBoolean(item.value);
                        break;
                    case "json":
                        parsedValue = JSON.parse(item.value);
                        break;
                    default:
                        parsedValue = item.value;
                }
                this.customParameters[item.key] = parsedValue;
            } catch (error: any) {
                this.logger.warn(`解析自定义参数失败 | 键: "${item.key}" | 值: "${item.value}" | 错误: ${error.message}`);
            }
        }
        if (Object.keys(this.customParameters).length > 0) {
            this.logger.debug(`已加载自定义参数 | ${JSON.stringify(this.customParameters)}`);
        }
    }

    public async chat(options: ChatRequestOptions): Promise<GenerateTextResult> {
        // 优先级: 运行时参数 > 模型配置 > 默认值
        const useStream = options.stream ?? this.config.stream ?? true;
        const chatOptions = this.buildChatOptions(options);

        // 本地控制器：承接外部 signal，并用于 earlyExit 主动中断
        const controller = new AbortController();

        if (options.abortSignal) {
            // 将本地 signal 注入到请求 fetch
            const baseFetch = chatOptions.fetch ?? this.fetch;
            chatOptions.fetch = (async (url: string, init: RequestInit) => {
                init.signal = AbortSignal.any([options.abortSignal, controller.signal]);
                //@ts-ignore
                return baseFetch(url, init);
            }) as typeof globalThis.fetch;
        }

        this.logger.info(`🚀 [请求开始] [${useStream ? "流式" : "非流式"}] 模型: ${this.id}`);

        return useStream
            ? await this._executeStream(chatOptions, options.onStreamStart, options.validation, controller)
            : await this._executeNonStream(chatOptions);
    }

    private buildChatOptions(options: ChatRequestOptions): ChatOptions {
        // 参数合并优先级 (后者覆盖前者):
        // 1. 模型配置中的基础参数 (temperature, topP)
        // 2. 模型配置中的自定义参数 (this.customParameters)
        // 3. 运行时传入的参数 (options)
        const { validation, onStreamStart, abortSignal, ...restOptions } = options;
        return {
            ...this.chatProvider(this.config.modelId),
            fetch: (async (url: string, init: RequestInit) => {
                init.signal = options.abortSignal;
                return this.fetch(url, init);
            }) as typeof globalThis.fetch,

            // 默认参数
            temperature: this.config.temperature,
            topP: this.config.topP,
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
     * 执行流式请求，并处理实时内容验证
     */
    private async _executeStream(
        chatOptions: ChatOptions,
        onStreamStart?: () => void,
        validation?: ValidationOptions,
        controller?: AbortController
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
        let earlyExitByValidator = false;

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
                            earlyExitByValidator = true;
                            // 使用解析后的干净数据替换部分流式文本
                            if (validationResult.parsedData) {
                                finalContentParts.splice(0, finalContentParts.length, JSON.stringify(validationResult.parsedData));
                            }
                            // 触发 AbortController 来中断HTTP连接
                            controller?.abort("early_exit");
                        }
                    }
                },
            });

            // FIXME: xsai 0.4.0 beta 修复了文本流
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
        } catch (error: any) {
            // "early_exit" 是我们主动中断流时产生的预期错误，应静默处理
            if (error.name === "AbortError" && earlyExitByValidator) {
                this.logger.debug(`🟢 [流式] 捕获到预期的 AbortError，流程正常结束。`);
            } else {
                throw error; // 重新抛出其他未预料的错误
            }
        }

        const duration = Date.now() - stime;
        const finalText = finalContentParts.join("");

        if (isEmpty(finalText)) {
            this.logger.warn(`💬 [流式] 模型未输出有效内容`);
            throw new Error("模型未输出有效内容");
        }

        /* prettier-ignore */
        this.logger.debug(`🏁 [流式] 传输完成 | 总耗时: ${duration}ms | 输入: ${finalUsage?.prompt_tokens || "N/A"} | 输出: ${finalUsage?.completion_tokens || `~${finalText.length / 4}`}`);

        // 对最终拼接的完整内容进行最后一次验证
        if (validator) {
            const finalValidation = validator(finalText, true);
            if (!finalValidation.valid) {
                const errorMsg = finalValidation.error || "格式不匹配或模型未输出有效内容";
                this.logger.warn(`⚠️ 最终内容验证失败 | 错误: ${errorMsg}`);
                throw new Error(`最终内容验证失败: ${errorMsg}`);
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
                let trimmedText = text.trim();
                // 兼容 ```json fenced code block
                if (trimmedText.startsWith("```")) {
                    const m = trimmedText.match(/^```(?:json)?\n([\s\S]*?)\n```$/);
                    if (m) trimmedText = m[1].trim();
                }
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
}
