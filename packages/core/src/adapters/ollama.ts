import { createOllama } from "@xsai-ext/providers-local";

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
