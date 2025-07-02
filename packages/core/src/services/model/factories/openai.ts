import { createOpenAI } from "../../../dependencies/xsai";
import { ProviderConfig } from "../config";
import { IProviderClient, IProviderFactory } from "./base";

export class OpenAIFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createOpenAI(apiKey, baseURL);
        return {
            chat: client,
            embed: client,
            image: client,
            speech: client,
            transcript: client,
        };
    }
}
