import { createOllama } from "../../../dependencies/xsai";
import { ProviderConfig } from "../config";
import { IProviderClient, IProviderFactory } from "./base";

export class OllamaFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { baseURL } = config;
        // Ollama 提供 Chat 和 Embedding
        const client = createOllama(baseURL);
        return {
            chat: client,
            embed: client,
        };
    }
}
