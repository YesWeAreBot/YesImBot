import { createGoogleGenerativeAI } from "../dependencies/xsai";

import { Config } from "./config";
import { BaseAdapter } from "./base";
import { LLMConfig } from "./config";

export class GeminiAdapter extends BaseAdapter {
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        if (!this.apiKey) {
            throw new Error('APIKey is required for GeminiAdapter');
        }
        this.provider = createGoogleGenerativeAI(this.apiKey, this.baseURL);
    }
}