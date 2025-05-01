import { createGoogleGenerativeAI } from '@xsai-ext/providers-cloud';

import { Config } from "../config";
import { BaseAdapter } from "./base";
import { LLMConfig } from "./config";

export class GeminiAdapter extends BaseAdapter {
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        if (!this.baseURL) {
            throw new Error('BaseURL is required for GeminiAdapter');
        }

        this.provider = createGoogleGenerativeAI(
            config.APIKey,
            config.BaseURL
        );
    }

    // async chat(messages: Message[], toolsSchema?: ToolResult[], debug = false): Promise<GenerateTextResult>
}