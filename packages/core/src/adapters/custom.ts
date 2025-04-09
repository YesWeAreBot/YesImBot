
import { Config } from "../config";
import { BaseAdapter } from "./base";
import { LLMConfig } from "./config";


export class CustomAdapter extends BaseAdapter {
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        if (!this.baseURL) {
            throw new Error('BaseURL is required for CustomAdapter');
        }
    }

    // async chat(messages: Message[], toolsSchema?: ToolResult[], debug = false): Promise<GenerateTextResult>
}
