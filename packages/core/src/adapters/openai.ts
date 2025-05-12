import { createOpenAI } from "../dependencies/xsai";

import { Config } from "./config";
import { BaseAdapter } from "./base";
import { LLMConfig } from "./config";


export class OpenAIAdapter extends BaseAdapter {
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        this.provider = createOpenAI(
            this.apiKey,
            this.baseURL,
        );
    }
}
