import { createOllama } from "@xsai-ext/providers-local";
import { generateText, GenerateTextResult } from '@xsai/generate-text';
import { ChatOptions, Message } from '@xsai/shared-chat';
import { streamText, StreamTextResult } from '@xsai/stream-text';
import { ToolResult } from '@xsai/tool';

import { Config } from "../config";
import { BaseAdapter } from "./base";
import { LLMConfig } from "./config";


export class OllamaAdapter extends BaseAdapter {
    constructor(private config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        if (!this.baseURL) {
            throw new Error('BaseURL is required for OllamaAdapter');
        }

        this.provider = createOllama(
            config.BaseURL
        );
    }

    // async chat(messages: Message[], toolsSchema?: ToolResult[], debug = false): Promise<GenerateTextResult>
}
