import { createOpenAI } from "../../../dependencies/xsai";
import { ProviderConfig } from "../types";
import { IProviderClient, IProviderFactory } from "./base";

export class OpenAIFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { APIKey, BaseURL } = config;
        const client = createOpenAI(APIKey, BaseURL);
        return {
            chat: client,
            embed: client,
            image: client,
            speech: client,
            transcript: client,
        };
    }
}
