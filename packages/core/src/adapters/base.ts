import type { ChatProvider } from '@xsai-ext/shared-providers';
import { Context } from "koishi";
import type { ChatOptions, GenerateTextResult, Message, ToolResult } from 'xsai';
import {
    createAnthropic,
    createDeepSeek,
    createFetch,
    createGoogleGenerativeAI,
    createLMStudio,
    createOllama,
    createOpenAI,
    createOpenRouter,
    createQwen,
    createSiliconFlow,
    createWorkersAI,
    createXAI,
    createZhipu,
    extractReasoning,
    extractReasoningStream,
    generateText,
    streamText,
} from '../dependencies/xsai';

import { isEmpty, isNotEmpty } from '../utils';
import { Config, LLMConfig } from "./config";

interface RequestOptions {
    logger: Context["logger"];
    debug: boolean;
    retry?: number;
    retryDelay?: number;
    retryStatusCodes?: number[];
    abortSignal?: AbortSignal;
}

export abstract class BaseAdapter {
    protected readonly baseURL: string;
    protected readonly apiKey: string;
    protected readonly model: string;
    protected readonly otherParams: Record<string, any>;
    readonly ability: LLMConfig["Ability"];

    protected provider?: ChatProvider;
    protected startWith?: string;
    protected reasoningTag?: string;
    protected startWithReasoning: boolean;

    constructor(
        protected config: LLMConfig,
        protected parameters?: Config["Parameters"]
    ) {
        const { APIKey, Model, Ability } = config;
        this.baseURL = config.BaseURL;
        this.apiKey = APIKey;
        this.model = Model;
        this.ability = Ability || [];

        if (this.ability.includes("深度思考")) {
            this.reasoningTag = config.TagName || "think";
            this.startWithReasoning = config.StartWithReasoning || false;
        }

        // 解析其他参数
        this.otherParams = {};
        if (this.parameters?.OtherParameters) {
            Object.entries(this.parameters.OtherParameters).forEach(([key, value]) => {
                const trimmedKey = key.trim();
                const trimmedValue = typeof value === 'string' ? value.trim() : value;

                let parsedValue = trimmedValue;
                // 尝试解析 JSON 字符串
                if (typeof trimmedValue === 'string') {
                    try {
                        parsedValue = JSON.parse(trimmedValue);
                    } catch (e) {
                        // 如果解析失败，保持原值
                    }
                }

                // 转换 value 为适当的类型
                switch (parsedValue) {
                    case 'true':
                        this.otherParams[trimmedKey] = true;
                        break;
                    case 'false':
                        this.otherParams[trimmedKey] = false;
                        break;
                    default:
                        if (typeof parsedValue === 'boolean') {
                            this.otherParams[trimmedKey] = parsedValue;
                            //@ts-ignore
                        } else if (!isNaN(parsedValue)) {
                            this.otherParams[trimmedKey] = Number(parsedValue);
                        } else {
                            this.otherParams[trimmedKey] = parsedValue;
                        }
                }
            });
        }
    }

    async chat(messages: Message[], tools?: ToolResult[], option?: RequestOptions): Promise<GenerateTextResult & { reasoning: string }> {
        const info = (info: string) => {
            if (option.debug) option.logger.info(info);
        };

        const fetch = createFetch({
            retry: option.retry,
            retryDelay: option.retryDelay,
            retryStatusCodes: option.retryStatusCodes,
        });

        // 公共参数
        const chatOptions: ChatOptions = {
            fetch,
            abortSignal: option?.abortSignal,
            ...(this.provider ? this.provider.chat(this.model) : { model: this.model, baseURL: this.baseURL, apiKey: this.apiKey }),
            ...(tools ? { tools } : {}),
            frequencyPenalty: this.parameters?.FrequencyPenalty,
            messages,
            presencePenalty: this.parameters?.PresencePenalty,
            maxSteps: 3,
            // seed
            //@ts-ignore
            stop: this.parameters?.Stop,
            temperature: this.parameters?.Temperature,
            // toolChoice
            topP: this.parameters?.TopP,
        }

        if (this.ability.includes("流式输出")) {
            let currentLineBuffer = "";
            let reasoningStreamContent = "";
            const result = await streamText({
                ...chatOptions,
                // maxSteps
                ...this.otherParams,
                streamOptions: {
                    includeUsage: true,
                },
                onChunk(chunk) {
                    // 兼容 DeepSeek
                    currentLineBuffer += chunk.choices[0].delta["reasoning_content"] || "";
                    reasoningStreamContent += chunk.choices[0].delta["reasoning_content"] || "";
                    if (currentLineBuffer.includes("\n")) {
                        info(currentLineBuffer.replace(/\n$/, ""));
                        currentLineBuffer = "";
                    }
                },
            })

            let textStream: ReadableStream<string>
            let textStreamContent = "";

            info(`Receiving text stream from ${this.model}...`);

            if (this.ability.includes("深度思考")) {
                const { reasoningStream, textStream: text } = extractReasoningStream(result["textStream"], { tagName: this.reasoningTag, startWithReasoning: true });
                textStream = text;
                for await (const reasoningPart of reasoningStream) {
                    reasoningStreamContent += reasoningPart;
                }
            } else {
                textStream = result["textStream"];
            }

            for await (const textPart of textStream) {
                if (isEmpty(textPart)) continue;
                textStreamContent += textPart;
                currentLineBuffer += textPart;
                if (currentLineBuffer.includes("\n")) {
                    info(currentLineBuffer.replace(/\n$/, ""));
                    currentLineBuffer = "";
                }
            }

            // 输出最后一行
            if (isNotEmpty(currentLineBuffer)) info(currentLineBuffer);
            info(`Streaming text from ${this.model} completed.`);

            for await (const step of result["stepStream"]) {
                if (step.finishReason == "tool_calls") {
                    function stringify(args: Record<string, unknown>): string {
                        let result = [];
                        for (let key in args) {
                            result.push(`${key}=${args[key]}`);
                        }
                        return `${result.join(', ')}`;
                    }
                    for (let executeToolResult of step.toolResults) {
                        info(`→ ${executeToolResult.toolName}(${stringify(executeToolResult.args)})`)
                        info(`← ${executeToolResult.result}`)
                    }
                    return this.chat(step.messages, tools, option);
                } else if (step.finishReason == "stop") {
                    return {
                        ...step,
                        text: textStreamContent,
                        reasoning: reasoningStreamContent,
                    } as unknown as GenerateTextResult & { reasoning: string };
                }
            }
        } else {
            // 非流式输出
            const result = await generateText({
                ...chatOptions,
                ...this.otherParams,
            });
            if (this.ability.includes("深度思考")) {
                const { reasoning, text } = extractReasoning(result.text, { tagName: this.reasoningTag, startWithReasoning: this.startWithReasoning })
                return {
                    ...result,
                    reasoning: reasoning || "",
                    text,
                };
            }
            return {
                ...result,
                reasoning: "",
            };
        }
    }

    abstract setProvider()
}

export class UniversalAdapter extends BaseAdapter {

    constructor(adapterConfig: LLMConfig, parameters?: Config["Parameters"]) {
        super(adapterConfig, parameters);
        this.setProvider();
    }

    setProvider() {
        const { APIKey, BaseURL } = this.config;
        switch (this.config.Provider) {
            case 'OpenAI':
            case 'OpenAI Compatible':
                this.provider = createOpenAI(APIKey, BaseURL);
                break;
            case 'Anthropic':
                this.provider = createAnthropic(APIKey, BaseURL);
                break;
            case 'Google Gemini':
                this.provider = createGoogleGenerativeAI(APIKey, BaseURL);
                break;
            case 'OpenRouter':
                this.provider = createOpenRouter(APIKey, BaseURL);
                break;
            case 'SiliconFlow':
                this.provider = createSiliconFlow(APIKey, BaseURL);
                break;
            case 'XAI':
                this.provider = createXAI(APIKey, BaseURL);
                break;
            case 'DeepSeek':
                this.provider = createDeepSeek(APIKey, BaseURL);
                break;
            case 'Zhipu':
                this.provider = createZhipu(APIKey, BaseURL);
                break;
            case 'LMStudio':
                this.provider = createLMStudio(BaseURL);
                break;
            case 'Ollama':
                this.provider = createOllama(BaseURL);
                break;
            case 'Qwen':
                this.provider = createQwen(APIKey, BaseURL);
                break;
            case 'Cloudflare WorkersAI':
                this.provider = createWorkersAI(APIKey, BaseURL);
                break;
            default:
                throw new InvalidAdapterTypeError("")
        }
    }
}



class InvalidAdapterTypeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidAPITypeError";
    }
}
