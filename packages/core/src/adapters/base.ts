import type { ChatProvider } from '@xsai-ext/shared-providers';
import { extractReasoning, extractReasoningStream } from '@xsai/utils-reasoning';
import { AssistantMessage, ChatOptions, generateText, GenerateTextResult, Message, streamText, ToolResult } from "xsai";

import { Config } from "../config";
import { isEmpty, isNotEmpty } from '../utils';
import logger from "../utils/logger";
import { LLMConfig } from "./config";


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
            this.reasoningTag = adapterConfig.ReasoningTag || "think";
            this.startWithReasoning = adapterConfig.startWithReasoning || false;
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
        logger.info(`[Adapter] ${APIType} registered`);
    }

    async chat(messages: Message[], tools?: ToolResult[], debug = false): Promise<GenerateTextResult & { reasoning: string }> {
        if (this.ability.includes("对话前缀续写") && this.startWith) {
            messages.push({ "role": "assistant", "content": this.startWith, "prefix": true } as AssistantMessage)
        }

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
                    if (debug) {
                        currentLineBuffer += chunk.choices[0].delta["reasoning_content"] || "";
                        reasoningStreamContent += chunk.choices[0].delta["reasoning_content"] || "";
                        if (currentLineBuffer.includes("\n")) {
                            process.stdout.write(currentLineBuffer);
                            currentLineBuffer = "";
                        }
                    }
                },
            })

            let textStream: ReadableStream<string>
            let textStreamContent = "";

            if (debug) {
                console.log(`Receiving text stream from ${this.model}...`);
            }
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
                if (debug) {
                    if (currentLineBuffer.includes("\n")) {
                        // 清除当前行并将光标移动到行首
                        //process.stdout.write('\x1B[K\r');
                        // 输出新的文本
                        process.stdout.write(currentLineBuffer);
                        // 重置当前行缓冲区
                        currentLineBuffer = "";
                    }
                }
            }
            if (debug) {
                // 输出最后一行
                if (isNotEmpty(currentLineBuffer)) console.log(currentLineBuffer);
                console.log(`Streaming text from ${this.model} completed.`);
            }

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
                        if (debug) {
                            console.log(`→ ${executeToolResult.toolName}(${stringify(executeToolResult.args)})`)
                            console.log(`← ${executeToolResult.result}`)
                        }
                    }
                    return this.chat(step.messages, tools, debug);
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
