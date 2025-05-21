import type { ChatProvider } from '@xsai-ext/shared-providers';
import { Context } from "koishi";
import type { ChatOptions, GenerateTextResult, Message, ToolResult } from 'xsai';
import {
    createAnthropic,
    createGoogleGenerativeAI,
    createOllama,
    createOpenAI,
    createOpenRouter,
    createQwen,
    createSiliconFlow,
    createWorkersAI,
    extractReasoning,
    extractReasoningStream,
    generateText,
    streamText
} from '../dependencies/xsai';

import { isEmpty, isNotEmpty } from '../utils';
import { Config, LLMConfig } from "./config";


function createFetch(option: { proxy?: string }): typeof globalThis.fetch {
    return (input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response> => {
        return fetch(input, { ...init, });
    }
}

interface RequestOptions {
    logger: Context["logger"];
    retry?: number;
    retryDelay?: number;
    abortSignal?: AbortSignal;
    debug?: boolean;
}

export abstract class BaseAdapter {
    protected readonly baseURL: string;
    protected readonly apiKey: string;
    protected readonly model: string;
    protected readonly otherParams: Record<string, any>;
    readonly ability: ("原生工具调用" | "识图功能" | "结构化输出" | "流式输出" | "深度思考" | "对话前缀续写")[];

    protected provider?: ChatProvider;
    protected startWith?: string;
    protected reasoningTag?: string;
    protected startWithReasoning: boolean;

    constructor(
        protected adapterConfig: LLMConfig,
        protected parameters?: Config["Parameters"]
    ) {
        const { APIKey, APIType, AIModel, Ability } = adapterConfig;
        this.baseURL = adapterConfig.BaseURL;
        this.apiKey = APIKey;
        this.model = AIModel;
        this.ability = Ability || [];

        if (this.ability.includes("深度思考")) {
            this.reasoningTag = adapterConfig.TagName || "think";
            this.startWithReasoning = adapterConfig.StartWithReasoning || false;
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
        // 公共参数
        const chatOptions: ChatOptions = {
            ...(this.provider ? this.provider.chat(this.model) : { model: this.model, baseURL: this.baseURL, apiKey: this.apiKey }),
            frequencyPenalty: this.parameters?.FrequencyPenalty,
            messages,
            presencePenalty: this.parameters?.PresencePenalty,
            // seed
            //@ts-ignore
            stop: this.parameters?.Stop,
            temperature: this.parameters?.Temperature,
            // toolChoice
            topP: this.parameters?.TopP,
            abortSignal: option?.abortSignal,
        }

        if (this.ability.includes("流式输出")) {
            let currentLineBuffer = "";
            let reasoningStreamContent = "";
            const result = await streamText({
                ...chatOptions,
                ...(tools ? { tools } : {}),
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
                        option?.logger.info(currentLineBuffer.replace(/\n$/, ""));
                        currentLineBuffer = "";
                    }
                },
            })

            let textStream: ReadableStream<string>
            let textStreamContent = "";

            option?.logger.info(`Receiving text stream from ${this.model}...`);

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
                    option?.logger.info(currentLineBuffer.replace(/\n$/, ""));
                    currentLineBuffer = "";
                }
            }

            // 输出最后一行
            if (isNotEmpty(currentLineBuffer)) option?.logger.info(currentLineBuffer);
            option?.logger.info(`Streaming text from ${this.model} completed.`);

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
                        option?.logger.info(`→ ${executeToolResult.toolName}(${stringify(executeToolResult.args)})`)
                        option?.logger.info(`← ${executeToolResult.result}`)
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
                ...(tools ? { tools } : {}),
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
}

export class CloudflareAdapter extends BaseAdapter {
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        if (!config.APIKey || !config.UID) {
            throw new Error('APIKey and UID are required for CloudflareAdapter');
        }
        this.provider = createWorkersAI(config.APIKey, config.UID);
    }
}


export class GeminiAdapter extends BaseAdapter {
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        if (!this.apiKey) {
            throw new Error('APIKey is required for GeminiAdapter');
        }
        this.provider = createGoogleGenerativeAI(this.apiKey, this.baseURL);
    }
}

export class CustomAdapter extends BaseAdapter {
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        if (!this.baseURL) {
            throw new Error('BaseURL is required for CustomAdapter');
        }
    }
}

export class OllamaAdapter extends BaseAdapter {
    constructor(private config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        if (!this.baseURL) {
            throw new Error('BaseURL is required for OllamaAdapter');
        }
        this.provider = createOllama(this.baseURL);
    }
}


export class OpenAIAdapter extends BaseAdapter {
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        this.provider = createOpenAI(
            this.apiKey,
            this.baseURL,
        );
    }
}


export class AnthropicAdapter extends BaseAdapter {
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        this.provider = createAnthropic(
            this.apiKey,
            this.baseURL,
        );
    }
}


export class QwenAdapter extends BaseAdapter {
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        this.provider = createQwen(
            this.apiKey,
            this.baseURL,
        );
    }
}

export class SiliconFlowAdapter extends BaseAdapter {
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        this.provider = createSiliconFlow(
            this.apiKey,
            this.baseURL,
        );
    }
}

export class OpenRouterAdapter extends BaseAdapter {
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        this.provider = createOpenRouter(
            this.apiKey,
            this.baseURL,
        );
    }
}
