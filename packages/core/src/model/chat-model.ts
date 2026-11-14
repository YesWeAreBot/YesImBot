import type { ChatProvider } from "@xsai-ext/shared-providers";
import type { GenerateTextResult } from "@xsai/generate-text";
import type { ChatOptions, CompletionStep, CompletionToolCall, CompletionToolResult, Message } from "@xsai/shared-chat";
import { Context } from "koishi";

import { budgetContext } from "../agent/context-budget";
import { chat as requestChat, generateText, streamText } from "../dependencies/xsai";
import type { LoggerService } from "../logger";
import { AppError, ErrorDefinitions } from "../shared/errors";
import { isEmpty, JsonParser, toBoolean } from "../shared/utils";
import { BaseModel, formatModelIdentity } from "./base-model";
import { ModelAbility, ModelConfig } from "./config";
import { parseContextLimit } from "./context-limit";
import { observeModelReportRequest, withModelConversationReport } from "./conversation-capture";
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
        const fetch = chatOptions.fetch!;
        chatOptions.fetch = observeModelReportRequest((input, init) => fetch(input as URL, init ?? {}));
        const capacity =
            this.config.contextLimit?.mode === "custom"
                ? parseContextLimit(this.config.contextLimit.value ?? "")
                : this.ctx?.yesimbot?.model?.peekContextLimit(this.config.providerName ?? "", this.id)?.tokens;
        const budget = budgetContext(chatOptions, capacity);
        chatOptions.messages = budget.messages;

        const imageCount = budget.messages.reduce(
            (sum, message) => sum + (Array.isArray(message.content) ? message.content.filter((part) => part.type === "image_url").length : 0),
            0,
        );
        this.logger.info(
            `[${requestId}] 模型请求 · ${useStream ? "流式" : "非流式"} · ${options.requestPurpose ?? "用途未标注"}${imageCount ? ` · 附带 ${imageCount} 张图片` : ""}`,
        );

        let streamDiagnostics: (() => Record<string, unknown>) | undefined;
        try {
            return await withModelConversationReport(
                { requestId, provider: this.config.providerName, model: this.id, purpose: options.requestPurpose ?? "对话" },
                () =>
                    withUsageScope({ contextBudget: budget.report }, () =>
                        useStream
                            ? this._executeStream(chatOptions, options.onStreamStart, options.validation, requestId, options.singleStep, (read) => {
                                  streamDiagnostics = read;
                              })
                            : this._executeNonStream(chatOptions, options.singleStep, options.validation, requestId),
                    ),
            );
        } catch (error) {
            this.logger.debug(
                `[${requestId}] 请求异常 | 类型: ${error?.name ?? typeof error} | 错误码: ${error?.code ?? "未知"} | 已取消: ${options.abortSignal?.aborted ?? false}`,
            );
            if (options.abortSignal?.aborted && options.abortSignal.reason?.name !== "TimeoutError") {
                this.logger.debug(`[${requestId}] 调用方已取消请求 | 用途: ${options.requestPurpose ?? "未标注"} | 不作为服务商故障重试`);
                throw options.abortSignal.reason ?? error;
            }
            const timeoutReason = options.abortSignal?.reason;
            return await this._wrapAndThrow(timeoutReason?.name === "TimeoutError" ? timeoutReason : error, requestId, useStream, streamDiagnostics?.());
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
        if (singleStep) {
            // The framework owns validation and execution. Never let the SDK parse
            // arguments or look up a tool before the caller can issue a correction.
            const response = await requestChat({ ...chatOptions, maxSteps: undefined, stream: false });
            const data = await response.json();
            chatOptions.abortSignal?.throwIfAborted();
            const choice = data.choices?.[0];
            if (!choice?.message) throw new Error("模型未返回有效回复");
            const message = choice.message;
            const calls = rawToolCalls(message.tool_calls ?? []);
            const step = {
                text: message.content ?? "",
                toolCalls: calls,
                toolResults: [],
                finishReason: choice.finish_reason,
                usage: data.usage,
                stepType: "initial",
            } as CompletionStep;
            result = { ...step, messages: [message], steps: [step] } as GenerateTextResult;
        } else {
            result = await generateText(chatOptions);
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
        this.logger.debug(`[传输完成] [${requestId}] [非流式] ${logMessage} | 耗时: ${duration}ms | 结束原因: ${result.finishReason ?? "未知"}`);
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
        singleStep = false,
        reportDiagnostics?: (read: () => Record<string, unknown>) => void,
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

        const completedResponses: StreamCompletion[] = [];
        let completion = new StreamCompletion();
        let buffer: string[] = [];
        let diagnostics = new StreamDiagnostics(stime);
        reportDiagnostics?.(() => diagnostics.summary());
        const markStreamStarted = () => {
            if (streamStarted) return;
            onStreamStart?.();
            streamStarted = true;
            this.logger.debug(`[${requestId}] 首次有效输出 · ${Date.now() - stime}ms`);
        };
        const originalFetch = chatOptions.fetch as (url: any, init: any) => Promise<Response>;
        const streamOptions = {
            ...chatOptions,
            fetch: async (url: URL, init: RequestInit) => {
                // xsai builds its own continuation messages; restore metadata on the
                // actual wire request, not merely on the final returned result.
                if (typeof init.body === "string" && completedResponses.length) {
                    const payload = JSON.parse(init.body);
                    for (const message of payload.messages ?? []) {
                        if (message.role !== "assistant" || !message.tool_calls?.length) continue;
                        const ids = message.tool_calls.map((call: any) => call.id);
                        const matches = completedResponses
                            .map((item) => item.assistantMessage(item.rawCalls()))
                            .filter(
                                (item: any) =>
                                    item?.tool_calls?.length === ids.length && item.tool_calls.every((call: any, index: number) => call.id === ids[index]),
                            );
                        if (matches.length === 1) Object.assign(message, matches[0]);
                    }
                    init = { ...init, body: JSON.stringify(payload) };
                }
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
                const headers = diagnostics.summary();
                this.logger.debug(`[${requestId}] HTTP 响应头 · ${response.status} · ${headers.contentType ?? "无 Content-Type"} · ${headers.headersMs}ms`);
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
                                if (completed && responseCompletion.hasTools) completedResponses.push(responseCompletion);
                            },
                        }),
                    );
                    return new Response(body, { status: observed.status, statusText: observed.statusText, headers: observed.headers });
                }
                return response;
            },
        };

        try {
            if (singleStep) {
                const response = await requestChat({ ...streamOptions, maxSteps: undefined, stream: true, streamOptions: { include_usage: true } } as any);
                if (!response.body) throw new Error("模型返回空流");
                const reader = response.body.getReader();
                try {
                    while (!(await reader.read()).done) {
                        /* completion observes the guarded transport */
                    }
                } finally {
                    reader.releaseLock();
                }
                finalToolCalls = completion.rawCalls();
                finalUsage = completion.usage;
                finalFinishReason = completion.finishReason;
                finalSteps = [
                    {
                        text: finalContentParts.join(""),
                        toolCalls: finalToolCalls,
                        toolResults: [],
                        usage: finalUsage,
                        finishReason: finalFinishReason,
                        stepType: "initial",
                    } as CompletionStep,
                ];
            } else {
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
            }
        } catch (error) {
            this.logger.debug(`[${requestId}] 流式异常 · ${error?.name ?? typeof error}`);
            const summary = diagnostics.summary();
            if (!(error instanceof AppError) && (summary.errorFrames || summary.malformedFrames)) {
                throw new AppError(ErrorDefinitions.LLM.REQUEST_FAILED, {
                    args: [error?.message || "SSE 协议异常"],
                    cause: error,
                    context: { streamDiagnostics: summary },
                });
            }
            throw error;
        } finally {
            const summary = diagnostics.summary();
            this.logger.debug(
                `[${requestId}] SSE 统计 · 首块数据 ${summary.firstChunkMs == null ? "未收到" : `${summary.firstChunkMs}ms`} · ${JSON.stringify(summary)}`,
            );
        }

        chatOptions.abortSignal?.throwIfAborted();
        const finalText = finalContentParts.join("");

        if (completion.hasUnterminatedData()) {
            throw new AppError(ErrorDefinitions.LLM.REQUEST_FAILED, {
                args: ["SSE 数据行未完整结束，响应可能被截断"],
                context: { streamDiagnostics: diagnostics.summary() },
            });
        }

        if (isEmpty(finalText) && finalToolCalls.length === 0) {
            const summary = diagnostics.summary();
            const emptyOutput = summary.reasoningChars
                ? "reasoning_only"
                : summary.contentChars
                  ? "blank_text"
                  : summary.frames
                    ? "no_output_frames"
                    : "no_frames";
            this.logger.debug(`[${requestId}] SSE 无有效正文或工具调用 · ${emptyOutput}`);
            throw new AppError(ErrorDefinitions.LLM.OUTPUT_EMPTY_CONTENT, {
                context: { rawResponse: finalText, details: "模型未输出有效内容", emptyOutput, streamDiagnostics: summary },
            });
        }

        // 对最终拼接的完整内容进行最后一次验证
        if (validator && finalToolCalls.length === 0) {
            const finalValidation = validator(finalText, true);
            if (!finalValidation.valid) {
                const errorMsg = finalValidation.error || "格式不匹配或模型未输出有效内容";
                this.logger.debug(`[${requestId}] 输出结构校验失败`);
                throw new AppError(ErrorDefinitions.LLM.OUTPUT_PARSING_FAILED, {
                    context: { rawResponse: finalText, details: errorMsg },
                });
            }
        }

        return {
            steps: finalSteps as Array<CompletionStep<true>>,
            messages: completedResponses.flatMap((response) => {
                const message = response.assistantMessage(finalToolCalls);
                return message ? [message] : [];
            }),
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

    private async _wrapAndThrow(error: any, requestId: string, isStream: boolean, streamDiagnostics?: Record<string, unknown>): Promise<never> {
        // 始终附加基础上下文信息
        const context: Record<string, any> = {
            modelId: this.id,
            provider: this.config.providerName,
            requestId,
            isStream,
            ...(streamDiagnostics ? { streamDiagnostics, httpStatus: streamDiagnostics.httpStatus } : {}),
        };

        // 1. 如果错误已经是我们自定义的 AppError，直接附加上下文并重新抛出
        if (error instanceof AppError) {
            error.addContext(context);
            throw error;
        }

        // An upstream AbortError alone does not indicate a request timeout.
        if (error?.name === "TimeoutError" || /^(?:request )?(?:timeout|timed out)$/i.test(error?.message ?? "")) {
            const seconds = typeof error.duration === "number" && Number.isFinite(error.duration) && error.duration > 0 ? error.duration : undefined;
            const duration = seconds === undefined ? "（上游未提供时限）" : ` (${seconds}s)`;
            if (seconds !== undefined) context.timeoutSeconds = seconds;
            this.logger.error(`🛑 [错误] 请求超时${duration} | 模型: ${this.id}`);
            throw new AppError(ErrorDefinitions.LLM.TIMEOUT, { args: [seconds], cause: error, context });
        }

        if (error?.name === "AbortError") {
            this.logger.debug(`[${requestId}] 上游连接中断`);
            throw new AppError(ErrorDefinitions.LLM.REQUEST_FAILED, { args: ["上游连接中断"], cause: error, context });
        }

        if (error?.name === "XSAIError" && error.response) {
            const { status } = error.response;
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
            throw new AppError(definition, { args: [`HTTP ${status}: ${error?.message ?? "无异常描述"}`], cause: error, context });
        }

        if (error?.message === "fetch failed") {
            this.logger.error(`🛑 [错误] 网络请求失败 (fetch failed) | 模型: ${this.id}`);
            throw new AppError(ErrorDefinitions.NETWORK.REQUEST_FAILED, { cause: error, context });
        }

        this.logger.error(`🛑 [错误] 未知或网络错误 | ${error?.message ?? "无异常描述"}`);
        throw new AppError(ErrorDefinitions.NETWORK.REQUEST_FAILED, { cause: error, context });
    }
}

function rawToolCalls(calls: any[]): CompletionToolCall[] {
    return calls.map(
        (call) => ({ toolCallId: call.id, toolCallType: call.type, toolName: call.function?.name, args: call.function?.arguments }) as CompletionToolCall,
    );
}

/** 协议授权独立于有长度限制的诊断。与 SDK 一样逐行解析，完整帧后立即释放正文。 */
class StreamCompletion {
    private readonly decoder = new TextDecoder();
    private pendingLine = "";
    completed = false;
    hasTools = false;
    earlyExit = false;
    private reasoningContent: string | undefined;
    private text = "";
    private readonly toolIds = new Map<number, string>();
    private readonly toolDeltas = new Map<number, any>();
    usage: any;
    finishReason: any = "unknown";
    rawCalls(): CompletionToolCall[] {
        return rawToolCalls([...this.toolDeltas.entries()].sort(([a], [b]) => a - b).map(([, call]) => call));
    }

    assistantMessage(calls: CompletionToolCall[]): Message | undefined {
        const ids = [...this.toolIds.entries()].sort(([left], [right]) => left - right).map(([, id]) => id);
        if (!this.completed || !ids.length || new Set(ids).size !== ids.length) return;
        const matched = ids.map((id) => {
            const candidates = calls.filter((call) => call.toolCallId === id);
            return candidates.length === 1 ? candidates[0] : undefined;
        });
        if (matched.some((call) => !call)) return;
        return {
            role: "assistant",
            content: this.text,
            ...(this.reasoningContent === undefined ? {} : { reasoning_content: this.reasoningContent }),
            tool_calls: matched.map((call, index) => ({
                index,
                id: call!.toolCallId,
                type: "function",
                function: { name: call!.toolName, arguments: call!.args },
            })),
        };
    }

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
                const frame = JSON.parse(data);
                if (frame.error) throw new AppError(ErrorDefinitions.LLM.REQUEST_FAILED, { args: [String(frame.error.message ?? frame.error)] });
                if (frame.usage) this.usage = frame.usage;
                choice = frame.choices?.[0];
            } catch (error) {
                throw new AppError(ErrorDefinitions.LLM.REQUEST_FAILED, { args: ["模型返回无效 SSE 帧"], cause: error });
            }
            if (choice?.finish_reason) this.finishReason = choice.finish_reason;
            if (typeof choice?.finish_reason === "string" && choice.finish_reason.length > 0) this.completed = true;
            if (choice?.delta?.yib_native_activity === true) {
                this.hasTools = true;
                this.onNativeActivity?.();
            }
            if (typeof choice?.delta?.reasoning_content === "string") this.reasoningContent = (this.reasoningContent ?? "") + choice.delta.reasoning_content;
            if (typeof choice?.delta?.content === "string") this.text += choice.delta.content;
            if (choice?.delta?.tool_calls?.length) {
                this.hasTools = true;
                for (const call of choice.delta.tool_calls) {
                    if (!Number.isSafeInteger(call.index) || call.index < 0) throw new Error("工具调用索引无效");
                    if (typeof call.id === "string") this.toolIds.set(call.index, call.id);
                    const prior = this.toolDeltas.get(call.index);
                    this.toolDeltas.set(call.index, {
                        ...prior,
                        ...call,
                        function: {
                            ...prior?.function,
                            ...call.function,
                            arguments: (prior?.function?.arguments ?? "") + (call.function?.arguments ?? ""),
                        },
                    });
                }
            }
            // Match the SDK's first-choice text path; validator failures must propagate.
            else if (typeof choice?.delta?.content === "string") this.onContent?.(choice.delta.content);
        }
    }
}
