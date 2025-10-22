import type { ChatProvider } from "@xsai-ext/shared-providers";
import type { GenerateTextResult } from "@xsai/generate-text";
import type { WithUnknown } from "@xsai/shared";
import type { ChatOptions, CompletionStep, CompletionToolCall, CompletionToolResult, Message } from "@xsai/shared-chat";
import { Logger } from "koishi";

import { generateText, streamText } from "@/dependencies/xsai";
import { isEmpty, isNotEmpty, toBoolean } from "@/shared/utils";
import { BaseModel } from "./base-model";
import { ChatModelConfig } from "./config";
import { ModelAbility } from "./types";

export interface ChatRequestOptions {
    abortSignal?: AbortSignal;
    onStreamStart?: () => void;
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
        logger: Logger,
        private readonly providerName: string,
        private readonly chatProvider: ChatProvider["chat"],
        modelConfig: ChatModelConfig,
        private readonly fetch: typeof globalThis.fetch
    ) {
        super(logger, modelConfig);
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

    public async chat(options: WithUnknown<ChatRequestOptions>): Promise<GenerateTextResult> {
        // 优先级: 运行时参数 > 模型配置 > 默认值
        const useStream = options.stream ?? true;
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
            ? await this._executeStream(chatOptions, options.onStreamStart, controller)
            : await this._executeNonStream(chatOptions);
    }

    private buildChatOptions(options: WithUnknown<ChatRequestOptions>): WithUnknown<ChatOptions> {
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
    private async _executeNonStream(chatOptions: WithUnknown<ChatOptions>): Promise<GenerateTextResult> {
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
        controller?: AbortController
    ): Promise<GenerateTextResult> {
        const stime = Date.now();
        let streamStarted = false;

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
            const { textStream, steps, fullStream, totalUsage } = streamText({
                ...chatOptions,
                abortSignal: controller?.signal,
                streamOptions: { includeUsage: true },
            });

            for await (const textDelta of textStream) {
                if (!streamStarted && isNotEmpty(textDelta)) {
                    onStreamStart?.();
                    streamStarted = true;
                    this.logger.debug(`🌊 流式传输已开始 | 延迟: ${Date.now() - stime}ms`);
                }
                if (textDelta === "") continue;

                buffer.push(textDelta);
                finalContentParts.push(textDelta);
            }

            finalSteps = await steps;
            finalUsage = await totalUsage;
        } catch (error: any) {
            // "early_exit" 是我们主动中断流时产生的预期错误，应静默处理
            if (error.name === "AbortError" && earlyExitByValidator) {
                this.logger.debug(`🟢 [流式] 捕获到预期的 AbortError，流程正常结束。`);
            } else if (error.name === "XSAIError") {
                switch (error.response.status) {
                    case 429:
                        this.logger.warn(`🟡 [流式] 请求过于频繁，请稍后再试。`);
                        break;
                    case 401:

                    default:
                        break;
                }
            } else {
                throw error;
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
}
