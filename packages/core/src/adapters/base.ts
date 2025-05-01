import type { ChatProvider } from '@xsai-ext/shared-providers';
import { AssistantMessage, ChatOptions, generateText, GenerateTextResult, Message, streamText, ToolResult } from "xsai";

import { Config } from "../config";
import { isNotEmpty } from '../utils';
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
    protected reasoningStart?: any;
    protected reasoningEnd?: any;
    protected reasoningEffort?: unknown;

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
            this.reasoningEffort = adapterConfig.ReasoningEffort || "medium";
            this.reasoningStart = adapterConfig.ReasoningStart || "<think>";
            this.reasoningEnd = adapterConfig.ReasoningEnd || "</think>";
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
        logger.info(`Adapter: ${APIType} registered`);
    }

    async chat(messages: Message[], tools?: ToolResult[], debug = false): Promise<GenerateTextResult> {
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
            const result = await streamText({
                ...chatOptions,
                ...(tools ? { tools } : {}),
                // maxSteps
                ...this.otherParams,
                streamOptions: {
                    includeUsage: true,
                }
            })

            let fullContent = "";
            let currentLineBuffer = "";
            if (debug) {
                console.log(`Receiving text stream from ${this.model}...`);
            }
            for await (const textPart of result["textStream"]) {
                fullContent += textPart;
                currentLineBuffer += textPart;
                if (debug) {
                    if (currentLineBuffer.includes("\n")) {
                        // 清除当前行并将光标移动到行首
                        process.stdout.write('\x1B[K\r');
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
                    // console.log(`${this.model} is calling tools...`)
                    // let fn: ToolCall["function"] = {
                    //     name: "",
                    //     arguments: ""
                    // };
                    // let toolCall: ToolCall = {
                    //     id: "",
                    //     type: "function",
                    //     function: fn
                    // };
                    // for (let tool of step.toolCalls) {
                    //     if (tool.toolName) fn["name"] = tool.toolName;
                    //     if (tool.args) fn["arguments"] = tool.args;
                    //     if (tool.toolCallId) toolCall["id"] = tool.toolCallId
                    // }
                    // let executeToolResult = await executeTool({
                    //     messages,
                    //     toolCall,
                    //     tools
                    // });
                    // messages.push(message.assistant(toolCall));
                    // messages.push(message.tool(executeToolResult.result, toolCall));
                    // return this.chat(messages, tools, debug);
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
                    if (this.ability.includes("深度思考")) {
                        fullContent = fullContent.replace(new RegExp(`${this.reasoningStart}[\\s\\S]*?${this.reasoningEnd}`, 'g'), '').trim();
                    }
                    return {
                        ...step,
                        text: fullContent,
                    } as unknown as GenerateTextResult;
                }
            }
        } else {
            // 非流式输出
            const result = await generateText({
                ...chatOptions,
                ...(tools ? { tools } : {}),
                reasoning_effort: this.ability.includes("深度思考") ? this.reasoningEffort : undefined, // 这部分可以通过 OtherParameters 实现
                // 确实，但既然已经有加深度思考复选框，所有的相关参数都应该包含在内，而不是让用户自己加。如果xsai内置了方便的提取与移除思维链的方法，那么就可以移除这堆配置项。
                ...this.otherParams,
            });
            if (this.ability.includes("深度思考")) {
                result.text = result.text.replace(new RegExp(`${this.reasoningStart}[\\s\\S]*?${this.reasoningEnd}`, 'g'), '').trim();
            }
            return result;
        }
    }

    // https://sdk.vercel.ai/docs/reference/ai-sdk-core/extract-reasoning-middleware
    protected extractReasoning(text: string, options: ReasoningOptions): { text: string; reasoning: string } {
        const { tagName, separator = "\n", startWithReasoning = false } = options;
        const regex = new RegExp(`<${tagName}>(.*?)<\/${tagName}>`, 's');
        const match = text.match(regex);
        if (match) {
            const reasoning = match[1].trim();
            const newText = text.replace(regex, '').trim();
            return {
                text: startWithReasoning ? `${reasoning}${separator}${newText}` : `${newText}${separator}${reasoning}`,
                reasoning
            }
        }
    }
}

interface ReasoningOptions {
    // The name of the XML tag to extract reasoning from (without angle brackets)
    tagName: string;
    // The separator to use between reasoning and text sections. Defaults to "\n"
    separator?: string;
    // Starts with reasoning tokens. Set to true when the response always starts with reasoning and the initial tag is omitted. Defaults to false.
    startWithReasoning?: boolean;
}
