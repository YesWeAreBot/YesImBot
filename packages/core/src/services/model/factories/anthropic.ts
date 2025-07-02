import { createAnthropic } from "../../../dependencies/xsai";
import { ProviderConfig } from "../config";
import type { IProviderClient, IProviderFactory } from "./base";

export class AnthropicFactory implements IProviderFactory {
    public createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createAnthropic(apiKey, baseURL);

        // Anthropic 的 xsai 实现目前只支持 chat
        return {
            chat: client,
            // embed 属性留空，因为不支持
        };
    }
}
