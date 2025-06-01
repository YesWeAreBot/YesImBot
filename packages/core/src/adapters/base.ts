import type { ChatProvider, EmbedProvider, ImageProvider } from "@xsai-ext/shared-providers";
import { ProxyAgent, fetch as ufetch } from "undici";

import {
    createAnthropic,
    createDeepSeek,
    createGoogleGenerativeAI,
    createLMStudio,
    createOllama,
    createOpenAI,
    createOpenRouter,
    createQwen,
    createSiliconFlow,
    createWorkersAI,
    createXAI,
    createZhipu,
} from "../dependencies/xsai";

import { isNotEmpty } from "../utils";
import { ChatModel } from "./chat";
import { ModelSetting, Provider as ProviderConfig } from "./config";
import { EmbedModel } from "./embed";

export class Provider {
    private fetch: typeof globalThis.fetch;
    private chatProvider: ChatProvider;
    private embedProvider: EmbedProvider;
    private imageProvider: ImageProvider;

    constructor(private config: ProviderConfig, private setting: ModelSetting) {
        this.fetch = (async (input, init) => {
            if (isNotEmpty(config.Proxy)) init = { ...init, dispatcher: new ProxyAgent(config.Proxy) };
            return await ufetch(input, init);
        }) as unknown as typeof globalThis.fetch;

        const { APIKey, BaseURL } = config;
        switch (config.Type) {
            case "OpenAI":
            case "OpenAI Compatible":
                this.chatProvider = createOpenAI(APIKey, BaseURL);
                break;
            case "Anthropic":
                this.chatProvider = createAnthropic(APIKey, BaseURL);
                break;
            case "Google Gemini":
                this.chatProvider = createGoogleGenerativeAI(APIKey, BaseURL);
                break;
            case "OpenRouter":
                this.chatProvider = createOpenRouter(APIKey, BaseURL);
                break;
            case "SiliconFlow":
                this.chatProvider = createSiliconFlow(APIKey, BaseURL);
                break;
            case "XAI":
                this.chatProvider = createXAI(APIKey, BaseURL);
                break;
            case "DeepSeek":
                this.chatProvider = createDeepSeek(APIKey, BaseURL);
                break;
            case "Zhipu":
                this.chatProvider = createZhipu(APIKey, BaseURL);
                break;
            case "LMStudio":
                this.chatProvider = createLMStudio(BaseURL);
                break;
            case "Ollama":
                this.chatProvider = createOllama(BaseURL);
                break;
            case "Qwen":
                this.chatProvider = createQwen(APIKey, BaseURL);
                break;
            case "Cloudflare WorkersAI":
                this.chatProvider = createWorkersAI(APIKey, BaseURL);
                break;
            default:
                throw new InvalidAdapterTypeError("");
        }
    }

    public getChatModel(index: number): ChatModel {
        const model = this.config.Models[index];
        return new ChatModel(this.chatProvider, model, this.setting, this.fetch);
    }

    public getEmbedModel() {
        // 具有嵌入能力的模型
        const model = this.config.Models.find((model) => model.Ability & (1 << 4));
        if (!model) {
            throw new Error("没有找到具有嵌入能力的模型");
        }
        return new EmbedModel(this.embedProvider, model.ModelID, this.fetch);
    }
}

class InvalidAdapterTypeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidAPITypeError";
    }
}
