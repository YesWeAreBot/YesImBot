import { createOllama } from "@xsai-ext/providers-local";
import { generateText, GenerateTextResult } from '@xsai/generate-text';
import { ChatOptions, Message } from '@xsai/shared-chat';
import { streamText, StreamTextResult } from '@xsai/stream-text';
import { ToolResult } from '@xsai/tool';

import { Config } from "../config";
import { BaseAdapter } from "./base";
import { LLMConfig } from "./config";


export class OllamaAdapter extends BaseAdapter {
    private provider: any;
    constructor(private config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        if (!this.baseURL) {
            throw new Error('BaseURL is required for OllamaAdapter');
        }

        this.provider = createOllama(
            config.BaseURL
        );
    }

    async chat(messages: Message[], toolsSchema?: ToolResult[], debug = false): Promise<GenerateTextResult> {
        // 公共参数
        const chatOptions: ChatOptions = {
            ...this.provider.chat(this.model),
            frequencyPenalty: this.parameters.FrequencyPenalty,
            messages,
            presencePenalty: this.parameters.PresencePenalty,
            // seed
            //@ts-ignore
            stop: this.parameters.Stop,
            temperature: this.parameters.Temperature,
            // toolChoice
            topP: this.parameters.TopP,
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
            for await (const step of result["stepStream"]) {
                return {
                    ...step,
                    text: fullContent,
                } as unknown as GenerateTextResult;
            }
        }

        // 非流式输出
        const result = await generateText({
            ...chatOptions,
            ...(toolsSchema ? { tools: toolsSchema } : {}),
            // reasoning_effort: this.ability.includes("深度思考")? this.reasoningEffort : undefined, 这部分可以通过 OtherParameters 实现
            ...this.otherParams,
        });
        return result;
    }
}
