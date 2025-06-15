import type { ChatProvider } from "@xsai-ext/shared-providers";
import { Context, isEmpty } from "koishi";
import type { ChatOptions, GenerateTextResult, Message, ToolResult } from "xsai";

import { extractReasoning, generateText, streamText } from "../dependencies/xsai";
import { isNotEmpty, toBoolean } from "../utils";
import { Ability, Model, ModelSetting } from "./config";

interface RequestOptions {
    debug?: boolean;
    logger?: Context["logger"];
    abortSignal?: AbortSignal;
    onStreamStart?: () => void;
}

export class ChatModel {
    private ability: (keyof typeof Ability)[];
    private customParameters: Record<string, unknown> = {};
    constructor(
        private chatProvider: ChatProvider,
        private model: Model,
        private modelSetting: ModelSetting,
        private fetch: typeof globalThis.fetch
    ) {
        this.ability = intToAbilities(model.Ability) as (keyof typeof Ability)[];

        for (let param of modelSetting.CustomParameters) {
            try {
                switch (param.type) {
                    case "文本":
                        this.customParameters[param.key] = String(param.value);
                        break;
                    case "数字":
                        this.customParameters[param.key] = Number(param.value);
                        break;
                    case "布尔值":
                        this.customParameters[param.key] = toBoolean(param.value);
                        break;
                    case "JSON":
                        this.customParameters[param.key] = JSON.parse(param.value);
                        break;
                    default:
                        this.customParameters[param.key] = param.value;
                }
            } catch (error) {
                // console.error()
            }
        }
    }

    get metadata() {
        return {
            provider: this.chatProvider,
            model: this.model,
        };
    }

    async chat(messages: Message[], tools?: ToolResult[], option: RequestOptions = {}): Promise<GenerateTextResult> {
        const info = (info: string) => {
            if (option.debug) option.logger.info(info);
        };

        // 公共参数
        const chatOptions: ChatOptions = {
            fetch: this.fetch,
            abortSignal: option?.abortSignal,
            ...this.chatProvider.chat(this.model.ModelID),
            ...(tools ? { tools } : {}),
            messages,
            // seed
            //@ts-ignore
            temperature: this.modelSetting.Temperature,
            // toolChoice
            topP: this.modelSetting.Top_P,
            ...this.customParameters,
        };

        if (this.modelSetting.Stream) {
            let currentLineBuffer = "";
            let currentReasoningBuffer = "";

            let reasoningStreamContent = "";

            let streamStart = false;

            const result = await streamText({
                ...chatOptions,
                // maxSteps
                ...this.customParameters,
                streamOptions: {
                    includeUsage: true,
                },
                // onChunk(chunk) {
                //     currentReasoningBuffer += chunk.choices[0].delta["reasoning_content"] || "";
                //     reasoningStreamContent += chunk.choices[0].delta["reasoning_content"] || "";
                //     if (
                //         currentReasoningBuffer.includes("\n") ||
                //         (isEmpty(chunk.choices[0].delta["reasoning_content"]) && isNotEmpty(chunk.choices[0].delta["content"]))
                //     ) {
                //         for (let line of currentReasoningBuffer.split("\n")) {
                //             if (isNotEmpty(line)) info(`> ${line}`);
                //         }
                //         currentReasoningBuffer = "";
                //     }
                // },
                onChunk() {
                    if (!streamStart) {
                        option?.onStreamStart();
                        streamStart = true;
                    }
                },
            });

            let textStream: ReadableStream<string> = result["textStream"];
            let textStreamContent = "";

            info(`Receiving text stream from ${this.model.ModelID}...`);

            for await (const textPart of textStream) {
                if (isEmpty(textPart)) continue;
                textStreamContent += textPart;
                currentLineBuffer += textPart;
                if (currentLineBuffer.includes("\n")) {
                    if (currentLineBuffer.endsWith("\n")) {
                        for (let line of currentLineBuffer.split("\n")) {
                            if (isNotEmpty(line)) info(line);
                        }
                        currentLineBuffer = "";
                    } else {
                        const lines = currentLineBuffer.split("\n");
                        const nextLine = lines.pop();
                        for (let line of lines) {
                            if (isNotEmpty(line)) info(line);
                        }
                        currentLineBuffer = nextLine;
                    }
                }
            }

            // 输出最后一行
            if (isNotEmpty(currentLineBuffer)) info(currentLineBuffer);
            info(`Streaming text from ${this.model.ModelID} completed.`);

            for await (const step of result["stepStream"]) {
                if (step.finishReason == "tool_calls") {
                    function stringify(args: Record<string, unknown>): string {
                        let result = [];
                        for (let key in args) {
                            result.push(`${key}=${args[key]}`);
                        }
                        return `${result.join(", ")}`;
                    }
                    for (let executeToolResult of step.toolResults) {
                        info(`→ ${executeToolResult.toolName}(${stringify(executeToolResult.args)})`);
                        info(`← ${executeToolResult.result}`);
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
            const result = await generateText(chatOptions);
            if (this.ability.includes("Reasoning")) {
                const { reasoning, text } = extractReasoning(result.text);
                info(reasoning);
                result.text = text;
            }
            info(result.text);
            return result;
        }
    }
}

/**
 * 将位集整数反向解析为对应的能力名称字符串数组。
 * 例如：12 => ["WebSearch", "Reasoning"]
 * @param bitset 输入的位集整数。
 * @returns 包含开启能力名称的字符串数组。
 */
function intToAbilities(bitset: number): string[] {
    const enabledAbilities: string[] = [];
    // 由于 Ability 是一个常规 enum (不是 const enum)，
    // 它会在运行时生成一个对象，可以用于反向查找。
    // Object.keys(Ability) 会返回字符串键（"Vision", "WebSearch"）和数字键（"2", "4"）。
    // 我们只需要遍历字符串键，它们对应着枚举成员的名称。
    for (const key in Ability) {
        // 过滤掉数字键，只保留字符串键
        // 并且确保这个key对应的值是数字类型（也就是枚举的实际数值成员）
        const value = Ability[key as keyof typeof Ability];
        if (typeof value === "number") {
            // 检查这个能力对应的位是否在输入整数中被设置
            if ((bitset & value) === value) {
                enabledAbilities.push(key); // 将能力名称添加到结果数组
            }
        }
    }
    return enabledAbilities;
}
