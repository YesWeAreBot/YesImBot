import { createOpenAI } from '@xsai-ext/providers-cloud';
import { generateText, GenerateTextResult } from '@xsai/generate-text';
import { AssistantMessage, ChatOptions, executeTool, Message, ToolCall } from '@xsai/shared-chat';
import { streamText } from '@xsai/stream-text';
import { ToolResult, } from '@xsai/tool';
import { message } from '@xsai/utils-chat';

import { Config } from "../config";
import { isNotEmpty } from '../utils';
import { BaseAdapter } from "./base";
import { LLMConfig } from "./config";


export class OpenAIAdapter extends BaseAdapter {
    private provider: any;
    private reasoningEffort: string;
    private reasoningStart: string;
    private reasoningEnd: string;
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        if (!this.baseURL) {
            throw new Error('BaseURL is required for OpenAIAdapter');
        }

        if (this.ability.includes("深度思考")) {
            this.reasoningEffort = config.ReasoningEffort || "medium";
            this.reasoningStart = config.ReasoningStart || "<think>";
            this.reasoningEnd = config.ReasoningEnd || "</think>";
        }

        this.provider = createOpenAI(
            config.APIKey,
            config.BaseURL
        );
    }

    async chat(messages: Message[], toolsSchema?: ToolResult[], debug = false): Promise<GenerateTextResult> {
        if (this.ability.includes("对话前缀续写") && this.startWith) {
            messages.push({ "role": "assistant", "content": this.startWith, "prefix": true } as AssistantMessage)
        }

        // 公共参数
        const chatOptions: ChatOptions = {
            ...this.provider.chat(this.model),
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
                ...(toolsSchema ? { tools: toolsSchema } : {}),
                // maxSteps
                ...this.otherParams,
                streamOptions: {
                    usage: true,
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
                    console.log(`${this.model} is calling tools...`)
                    let fn: ToolCall["function"] = {
                        name: "",
                        arguments: ""
                    };
                    let toolCall: ToolCall = {
                        id: "",
                        type: "function",
                        function: fn
                    };
                    for (let tool of step.toolCalls) {
                        if (tool.toolName) fn["name"] = tool.toolName;
                        if (tool.args) fn["arguments"] = tool.args;
                        if (tool.toolCallId) toolCall["id"] = tool.toolCallId
                    }
                    let executeToolResult = await executeTool({
                        messages,
                        toolCall,
                        tools: toolsSchema
                    });
                    messages.push(message.assistant(toolCall));
                    messages.push(message.tool(executeToolResult.result, toolCall));
                    return this.chat(messages, toolsSchema, debug);
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
                ...(toolsSchema ? { tools: toolsSchema } : {}),
                reasoning_effort: this.ability.includes("深度思考") ? this.reasoningEffort : undefined, // 这部分可以通过 OtherParameters 实现
                ...this.otherParams,
            });
            if (this.ability.includes("深度思考")) {
                result.text = result.text.replace(new RegExp(`${this.reasoningStart}[\\s\\S]*?${this.reasoningEnd}`, 'g'), '').trim();
            }
            return result;
        }
    }
}
