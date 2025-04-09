import { createOpenAI } from '@xsai-ext/providers-cloud';

import { Config } from "../config";
import { BaseAdapter } from "./base";
import { LLMConfig } from "./config";


export class OpenAIAdapter extends BaseAdapter {
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        if (!this.baseURL) {
            throw new Error('BaseURL is required for OpenAIAdapter');
        }
        // 兼容旧版配置
        let baseURL = this.baseURL.endsWith('/') ? this.baseURL.slice(0, -1) : this.baseURL;
        if (!baseURL.endsWith('/v1')) {
            baseURL += '/v1';
        }

        this.provider = createOpenAI(
            this.apiKey,
            baseURL,
        );
    }
    // async chat(messages: Message[], toolsSchema?: ToolResult[], debug = false): Promise<GenerateTextResult>
}
