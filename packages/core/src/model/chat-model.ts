import type { ChatProvider } from "@xsai-ext/shared-providers";
import type { GenerateTextResult } from "@xsai/generate-text";
import type { ChatOptions, CompletionStep, CompletionToolCall, CompletionToolResult, Message } from "@xsai/shared-chat";
import { Context } from "koishi";

import { budgetContext } from "../agent/context-budget";
import { generateText, streamText } from "../dependencies/xsai";
import type { LoggerService } from "../logger";
import { AppError, ErrorDefinitions } from "../shared/errors";
import { isEmpty, JsonParser, toBoolean } from "../shared/utils";
import { BaseModel, formatModelIdentity } from "./base-model";
import { ModelAbility, ModelConfig } from "./config";
import { parseContextLimit } from "./context-limit";
import { StreamDiagnostics } from "./stream-diagnostics";
import { observeUsageFetch, withUsageScope } from "./usage";
import type { UsageOwner } from "./usage-owner";

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
    /** 本地诊断用途，不发送给服务商。 */
    requestPurpose?: string;
    /** 原生工具调用不可用时使用的完整 JSON 请求，仅由模型切换器消费。 */
    nativeToolCallingFallback?: ChatRequestOptions;
    singleStep?: boolean;
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
    private static requestSequence = 0;
    private readonly customParameters: Record<string, unknown> = {};

    constructor(
        ctx: Context,
        private readonly chatProvider: ChatProvider["chat"],
        modelConfig: ModelConfig,
        private readonly fetch: typeof globalThis.fetch,
        logging: LoggerService,
        usageOwner?: UsageOwner,
    ) {
        super(ctx, modelConfig, `[聊天模型] ${formatModelIdentity(modelConfig)}`, logging);
        this.fetch = observeUsageFetch(ctx, { provider: modelConfig.providerName ?? "未知", model: this.id, purpose: "对话" }, fetch, usageOwner);
        this.parseCustomParameters();
    }

    public isVisionModel(): boolean {
        return this.config.abilities.includes(ModelAbility.Vision);
    }

    /**
     * 解析并加载模型配置文件中的自定义参数
     */
    private parseCustomParameters(): void {
        if (!this.config.parameters?.custom) return;
        for (const item of this.config.parameters.custom) {
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
                    case "object":
                        parsedValue = JSON.parse(item.value);
                        break;
                    default:
                        parsedValue = item.value;
                }
                this.customParameters[item.key] = parsedValue;
            } catch (error) {
                this.logger.warn(`解析自定义参数失败 | 键: "${item.key}" | 值: "${item.value}" | 错误: ${error.message}`);
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
        const useStream = options.stream ?? this.config.parameters?.stream ?? true;
        const requestId = `chat-${++ChatModel.requestSequence}`;
        const chatOptions = this.buildChatOptions(options);
        const capacity =
            this.config.contextLimit?.mode === "custom"
                ? parseContextLimit(this.config.contextLimit.value ?? "")
                : this.ctx?.yesimbot?.model?.peekContextLimit(this.config.providerName ?? "", this.id)?.tokens;
        const budget = budgetContext(chatOptions, capacity);
        chatOptions.messages = budget.messages;

        this.logger.info(`🚀 [请求开始] [${requestId}] [${useStream ? "流式" : "非流式"}] 模型: ${this.id} | 用途: ${options.requestPurpose ?? "未标注"}`);

        try {
            return await withUsageScope({ contextBudget: budget.report }, () =>
                useStream
                    ? this._executeStream(chatOptions, options.onStreamStart, options.validation, requestId)
                    : this._executeNonStream(chatOptions, options.singleStep, options.validation, requestId),
            );
        } catch (error) {
            this.logger.debug(
                `[${requestId}] 请求异常 | 类型: ${error.name} | 错误码: ${error.code ?? "未知"} | 已取消: ${options.abortSignal?.aborted ?? false}`,
            );
            if (options.abortSignal?.aborted && options.abortSignal.reason?.name !== "TimeoutError") {
                this.logger.debug(`[${requestId}] 调用方已取消请求 | 用途: ${options.requestPurpose ?? "未标注"} | 不作为服务商故障重试`);
                throw options.abortSignal.reason ?? error;
            }
            const timeoutReason = options.abortSignal?.reason;
            return await this._wrapAndThrow(timeoutReason?.name === "TimeoutError" ? timeoutReason : error, chatOptions);
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
        const { validation, onStreamStart, abortSignal, singleStep, nativeToolCallingFallback, requestPurpose, ...restOptions } = options;
        const chatOptions: ChatOptions = {
            ...this.chatProvider(this.config.modelId),
            abortSignal,
            fetch: async (url: any, init: any) => {
                init.signal = options.abortSignal;
                return this.fetch(url, init);
            },

            // 默认参数
            temperature: this.config.parameters?.temperature,
            topP: this.config.parameters?.topP,
            ...this.customParameters,

            // 运行时参数 (会覆盖上面的默认值)
            ...restOptions,
        };
        if (this.config.disableNativeToolCalling) {
            // 最后过滤，避免自定义参数或调用方重新启用不支持的 API 特性。
            for (const key of [
                "tools",
                "toolChoice",
                "tool_choice",
                "functions",
                "functionCall",
                "function_call",
                "parallelToolCalls",
                "parallel_tool_calls",
            ]) {
                delete chatOptions[key];
            }
        }
        return chatOptions;
    }

    /**
     * 执行非流式请求
     */
    private async _executeNonStream(
        chatOptions: ChatOptions,
        singleStep = false,
        validation?: ValidationOptions,
        requestId?: string,
    ): Promise<GenerateTextResult> {
        const stime = Date.now();
        let result: GenerateTextResult;
        try {
            result = await generateText({
                ...chatOptions,
                ...(singleStep
                    ? {
                          onStepFinish: (step: CompletionStep) => {
                              throw new SingleStepComplete(step);
                          },
                      }
                    : {}),
            });
        } catch (error) {
            if (!(error instanceof SingleStepComplete)) throw error;
            result = { ...error.step, steps: [error.step], messages: [], text: error.step.text ?? "" } as GenerateTextResult;
        }
        if (isEmpty(result.text) && !result.toolCalls?.length) {
            throw new AppError(ErrorDefinitions.LLM.OUTPUT_EMPTY_CONTENT, {
                context: { rawResponse: result.text, details: "模型未输出有效内容" },
            });
        }
        const validator = this._getValidator(validation);
        if (validator && !result.toolCalls?.length) {
            const finalValidation = validator(result.text ?? "", true);
            if (!finalValidation.valid) {
                throw new AppError(ErrorDefinitions.LLM.OUTPUT_PARSING_FAILED, {
                    context: { rawResponse: result.text, details: finalValidation.error || "格式不匹配或模型未输出有效内容" },
                });
            }
        }
        const duration = Date.now() - stime;

        const logMessage = result.toolCalls?.length
            ? `工具调用: "${result.toolCalls.map((tc) => tc.toolName).join(", ")}"`
            : `文本长度: ${result.text?.length ?? 0}`;
        this.logger.success(`✅ [传输完成] [${requestId}] [非流式] ${logMessage} | 耗时: ${duration}ms | 结束原因: ${result.finishReason ?? "未知"}`);
        return result;
    }

    /**
     * 执行流式请求，并处理实时内容验证。
     */
    private async _executeStream(
        chatOptions: ChatOptions,
        onStreamStart?: () => void,
        validation?: ValidationOptions,
        requestId = "stream",
    ): Promise<GenerateTextResult> {
        const stime = Date.now();
        let streamStarted = false;
        const validator = this._getValidator(validation);

        const finalContentParts: string[] = [];
        let finalSteps: CompletionStep[] = [];
        let finalToolCalls: CompletionToolCall[] = [];
        let finalToolResults: CompletionToolResult[] = [];
        let finalUsage: any = undefined;
        let finalFinishReason: GenerateTextResult["finishReason"] = "unknown";

        let completion = new StreamCompletion();
        let buffer: string[] = [];
        let diagnostics = new StreamDiagnostics(stime);
        const markStreamStarted = () => {
            if (streamStarted) return;
            onStreamStart?.();
            streamStarted = true;
            this.logger.debug(`🌊 流式传输已开始 | 延迟: ${Date.now() - stime}ms`);
        };
        const originalFetch = chatOptions.fetch as (url: any, init: any) => Promise<Response>;
        const streamOptions = {
            ...chatOptions,
            fetch: async (url: URL, init: RequestInit) => {
                const response = await originalFetch(url, init);
                // 多步工具响应每次都必须有自己的终止信号。
                diagnostics = new StreamDiagnostics(stime);
                buffer = [];
                // Validate complete SSE text before the transport EOF gate, not in downstream SDK events.
                const responseCompletion = (completion = new StreamCompletion((textDelta) => {
                    if (responseCompletion.earlyExit || !textDelta) return;
                    markStreamStarted();
                    buffer.push(textDelta);
                    finalContentParts.push(textDelta);
                    if (!validator) return;
                    const validationResult = validator(buffer.join(""));
                    if (!validationResult.valid || !validationResult.earlyExit) return;
                    responseCompletion.earlyExit = true;
                    this.logger.debug(`✅ 内容有效，可提前结束流 | 耗时: ${Date.now() - stime}ms`);
                    if (validationResult.parsedData) finalContentParts.splice(0, finalContentParts.length, JSON.stringify(validationResult.parsedData));
                }, markStreamStarted));
                diagnostics.recordResponse(response);
                this.logger.debug(`[${requestId}] HTTP 响应 | ${JSON.stringify(diagnostics.summary())}`);
                if (response.ok) {
                    const contentType = response.headers.get("content-type");
                    // 缺少类型头时保留原有兼容行为；明确返回其他格式时不能静默判空。
                    if (contentType && contentType.split(";")[0].trim().toLowerCase() !== "text/event-stream") {
                        await response.body?.cancel();
                        throw new AppError(ErrorDefinitions.LLM.REQUEST_FAILED, {
                            args: [`流式请求需要 SSE，收到 Content-Type: ${contentType}`],
                            context: { httpStatus: response.status, contentType },
                        });
                    }
                    // xsai 在响应体结束后、streamText 返回前执行工具。必须在本次
                    // body 的 flush 边界阻止异常 EOF，不能等 SDK 返回后再检查。
                    const observed = diagnostics.observe(response);
                    if (!observed.body) return observed;
                    const body = observed.body.pipeThrough(
                        new TransformStream<Uint8Array, Uint8Array>({
                            transform: (chunk, controller) => {
                                chatOptions.abortSignal?.throwIfAborted();
                                responseCompletion.observe(chunk);
                                chatOptions.abortSignal?.throwIfAborted();
                                controller.enqueue(chunk);
                                // Tool-capable responses must finish before the SDK may execute their calls.
                                // Termination closes only this body; it never aborts the caller's controller.
                                if (
                                    responseCompletion.earlyExit &&
                                    !chatOptions.tools?.length &&
                                    !responseCompletion.hasTools &&
                                    !responseCompletion.hasUnterminatedData()
                                )
                                    controller.terminate();
                            },
                            flush: () => {
                                responseCompletion.finish();
                                if (chatOptions.abortSignal?.aborted) {
                                    throw chatOptions.abortSignal.reason ?? new DOMException("Request aborted", "AbortError");
                                }
                                const summary = diagnostics.summary();
                                const completed = !responseCompletion.hasUnterminatedData() && responseCompletion.completed;
                                // 验证器只能提前接受文本，不能授权不完整的工具调用。
                                if (
                                    responseCompletion.hasUnterminatedData() ||
                                    (!completed && (!responseCompletion.earlyExit || responseCompletion.hasTools))
                                ) {
                                    throw new AppError(ErrorDefinitions.LLM.REQUEST_FAILED, {
                                        args: ["SSE 响应异常 EOF：未收到完整的完成或终止信号"],
                                        context: { streamDiagnostics: summary },
                                    });
                                }
                            },
                        }),
                    );
                    return new Response(body, { status: observed.status, statusText: observed.statusText, headers: observed.headers });
                }
                return response;
            },
        };

        try {
            const stream = await streamText({
                ...streamOptions,
                streamOptions: { includeUsage: true },
                onEvent: (event) => {
                    if (!streamStarted && (event.type === "tool-call-streaming-start" || event.type === "tool-call-delta")) {
                        onStreamStart?.();
                        streamStarted = true;
                    }
                },
            });

            // SDK 的各个结果 Promise 可能一起拒绝，均附加处理避免未处理异常。
            for (const promise of [stream.steps, stream.usage, stream.messages]) void promise.catch(() => {});

            // xsai 0.3.5 的结果 Promise 可能丢失异常，fullStream 仍保留原始错误。
            // 文本继续由 onEvent 实时处理，此处只确认整条流成功完成。
            const reader = stream.fullStream.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value.type === "error") {
                        throw new AppError(ErrorDefinitions.LLM.REQUEST_FAILED, {
                            args: [String(value.error)],
                            cause: value.error instanceof Error ? value.error : undefined,
                        });
                    }
                }
            } finally {
                reader.releaseLock();
            }

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
            this.logger.debug(`[${requestId}] 流式异常 | 类型: ${error.name} | ${JSON.stringify(diagnostics.summary())}`);
            const summary = diagnostics.summary();
            if (!(error instanceof AppError) && (summary.errorFrames || summary.malformedFrames)) {
                throw new AppError(ErrorDefinitions.LLM.REQUEST_FAILED, {
                    args: [error.message],
                    cause: error,
                    context: { streamDiagnostics: summary },
                });
            }
            throw error;
        } finally {
            const summary = diagnostics.summary();
            this.logger.debug(
                `[${requestId}] 响应概况 | 耗时: ${summary.elapsedMs}ms | 首包: ${summary.firstChunkMs ?? "未知"}ms | 正文: ${summary.contentChars}字 | 推理: ${summary.reasoningChars}字 | 结束原因: ${summary.finishReason ?? "未知"} | 结束帧: ${summary.done ? "已收到" : "未收到"}`,
            );
            this.logger.debug(`[${requestId}] 流式汇总 | ${JSON.stringify(summary)}`);
        }

        chatOptions.abortSignal?.throwIfAborted();
        const duration = Date.now() - stime;
        const finalText = finalContentParts.join("");

        if (completion.hasUnterminatedData()) {
            throw new AppError(ErrorDefinitions.LLM.REQUEST_FAILED, {
                args: ["SSE 数据行未完整结束，响应可能被截断"],
                context: { streamDiagnostics: diagnostics.summary() },
            });
        }

        if (isEmpty(finalText) && finalToolCalls.length === 0) {
            this.logger.warn(`💬 [流式] 模型未输出有效内容`);
            throw new AppError(ErrorDefinitions.LLM.OUTPUT_EMPTY_CONTENT, {
                context: { rawResponse: finalText, details: "模型未输出有效内容", streamDiagnostics: diagnostics.summary() },
            });
        }

        /* prettier-ignore */
        this.logger.debug(`🏁 [流式] 传输完成 | 总耗时: ${duration}ms | 输入: ${finalUsage?.prompt_tokens || "N/A"} | 输出: ${finalUsage?.completion_tokens || `~${finalText.length / 4}`}`);

        // 对最终拼接的完整内容进行最后一次验证
        if (validator && finalToolCalls.length === 0) {
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
            steps: finalSteps as Array<CompletionStep<true>>,
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
                if ((trimmedText.startsWith("{") && trimmedText.endsWith("}")) || (trimmedText.startsWith("[") && trimmedText.endsWith("]"))) {
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
        const context: Record<string, any> = {
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
        if (error.name === "AbortError" || error.name === "TimeoutError" || error.message === "timeout") {
            const seconds = typeof error.duration === "number" && Number.isFinite(error.duration) && error.duration > 0 ? error.duration : undefined;
            const duration = seconds === undefined ? "（上游未提供时限）" : ` (${seconds}s)`;
            if (seconds !== undefined) context.timeoutSeconds = seconds;
            this.logger.error(`🛑 [错误] 请求超时${duration} | 模型: ${this.id}`);
            throw new AppError(ErrorDefinitions.LLM.TIMEOUT, { args: [seconds], cause: error, context });
        }

        if (error.name === "XSAIError" && error.response) {
            const { status, url } = error.response;
            context["url"] = url;
            context["httpStatus"] = status;
            const retryAfter = error.response.headers?.get("retry-after");
            if (retryAfter) {
                const seconds = Number(retryAfter);
                const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
                if (Number.isFinite(delay) && delay >= 0) context["retryAfterMs"] = delay;
            }

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

/** 单步调用交回框架；真实工具只在模型请求完整成功后执行。 */
class SingleStepComplete extends Error {
    constructor(public readonly step: CompletionStep) {
        super("Single step complete");
    }
}

/** 协议授权独立于有长度限制的诊断。与 SDK 一样逐行解析，完整帧后立即释放正文。 */
class StreamCompletion {
    private readonly decoder = new TextDecoder();
    private pendingLine = "";
    completed = false;
    hasTools = false;
    earlyExit = false;

    constructor(
        private readonly onContent?: (text: string) => void,
        private readonly onNativeActivity?: () => void,
    ) {}

    observe(chunk: Uint8Array): void {
        this.scan(this.decoder.decode(chunk, { stream: true }));
    }
    finish(): void {
        this.scan(this.decoder.decode());
    }
    hasUnterminatedData(): boolean {
        if (!this.pendingLine.startsWith("data:")) return false;
        // 兼容上游省略 DONE 尾行换行；尾标自身不能授权异常 EOF。
        return !(this.completed && this.pendingLine.slice(5).trim() === "[DONE]");
    }

    private scan(text: string): void {
        const lines = (this.pendingLine + text).split("\n");
        this.pendingLine = lines.pop() ?? "";
        for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") {
                this.completed = true;
                break;
            }
            let choice: any;
            try {
                choice = JSON.parse(data)?.choices?.[0];
            } catch {
                // SDK 保留原始解析错误；这里不把畸形帧当作完成信号。
                continue;
            }
            if (typeof choice?.finish_reason === "string" && choice.finish_reason.length > 0) this.completed = true;
            if (choice?.delta?.yib_native_activity === true) {
                this.hasTools = true;
                this.onNativeActivity?.();
            }
            if (choice?.delta?.tool_calls?.length) this.hasTools = true;
            // Match the SDK's first-choice text path; validator failures must propagate.
            else if (typeof choice?.delta?.content === "string") this.onContent?.(choice.delta.content);
        }
    }
}
