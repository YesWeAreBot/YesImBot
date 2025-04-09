import { createWorkersAI } from '@xsai-ext/providers-cloud';
import { generateText, GenerateTextResult } from '@xsai/generate-text';
import { AssistantMessage, ChatOptions, Message } from '@xsai/shared-chat';
import { streamText } from '@xsai/stream-text';
import { ToolResult } from '@xsai/tool';

import { Config } from "../config";
import { BaseAdapter } from "./base";
import { LLMConfig } from "./config";


export class CloudflareAdapter extends BaseAdapter {
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        if (!this.baseURL) {
            throw new Error('BaseURL is required for OpenAIAdapter');
        }

        this.provider = createWorkersAI(
            config.APIKey,
            config.UID
        );
    }

    // async chat(messages: Message[], toolsSchema?: ToolResult[], debug = false): Promise<GenerateTextResult>
}
