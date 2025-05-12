import { createWorkersAI } from "../dependencies/xsai";

import { BaseAdapter } from "./base";
import { Config, LLMConfig } from "./config";


export class CloudflareAdapter extends BaseAdapter {
    constructor(config: LLMConfig, parameters?: Config["Parameters"]) {
        super(config, parameters);
        if (!config.APIKey || !config.UID) {
            throw new Error('APIKey and UID are required for CloudflareAdapter');
        }
        this.provider = createWorkersAI(config.APIKey, config.UID);
    }
}
