import { createOllama } from "../../../dependencies/xsai";
import { ProviderConfig } from "../types";
import { IProviderClient, IProviderFactory } from "./base";

export class OllamaFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { BaseURL } = config;
        // Ollama 提供 Chat 和 Embedding
        const client = createOllama(BaseURL);
        return {
            chat: client,
            embed: client,
        };
    }
}
