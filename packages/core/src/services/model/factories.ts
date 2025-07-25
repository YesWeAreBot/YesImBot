import type {
    ChatProvider,
    EmbedProvider,
    ImageProvider,
    ModelProvider,
    SpeechProvider,
    TranscriptionProvider,
} from "@xsai-ext/shared-providers";

import {
    createAnthropic,
    createDeepSeek,
    createFireworks,
    createGoogleGenerativeAI,
    createLMStudio,
    createOllama,
    createOpenAI,
    createQwen,
    createSiliconFlow,
    createWorkersAI,
    createZhipu,
} from "@/dependencies/xsai";
import { ProviderConfig, ProviderType } from "./config";

export interface IProviderClient {
    chat?: ChatProvider["chat"];
    embed?: EmbedProvider["embed"];
    image?: ImageProvider["image"];
    speech?: SpeechProvider["speech"];
    transcript?: TranscriptionProvider["transcription"];
    model?: ModelProvider["model"];
}

export interface IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient;
}

/** baseURL = http://localhost:11434/v1/ */
class OllamaFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { baseURL } = config;
        const client = createOllama(baseURL);
        return { chat: client.chat, embed: client.embed, model: client.model };
    }
}

/** baseURL = https://api.anthropic.com/v1/ */
class AnthropicFactory implements IProviderFactory {
    public createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createAnthropic(apiKey, baseURL);
        return { chat: client.chat, model: client.model };
    }
}

/** baseURL = https://api.openai.com/v1/ */
class OpenAIFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createOpenAI(apiKey, baseURL);
        return {
            chat: client.chat,
            embed: client.embed,
            image: client.image,
            speech: client.speech,
            transcript: client.transcription,
            model: client.model,
        };
    }
}

class FireworksFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createFireworks(apiKey, baseURL);
        return { chat: client.chat, embed: client.embed, model: client.model };
    }
}

/** baseURL = https://api.deepseek.com/ */
class DeepSeekFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createDeepSeek(apiKey, baseURL);
        return { chat: client.chat, model: client.model };
    }
}

/** baseURL = https://generativelanguage.googleapis.com/v1beta/openai/ */
class GoogleGenerativeAIFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createGoogleGenerativeAI(apiKey, baseURL);
        return { chat: client.chat, embed: client.embed, model: client.model };
    }
}

class LMStudioFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { baseURL } = config;
        const client = createLMStudio(baseURL);
        return { chat: client.chat, embed: client.embed, model: client.model };
    }
}

class WorkersAIFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createWorkersAI(apiKey, baseURL);
        return { chat: client.chat, embed: client.embed };
    }
}

class ZhipuFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createZhipu(apiKey, baseURL);
        return { chat: client.chat, embed: client.embed, model: client.model };
    }
}

/** baseURL = https://api.siliconflow.cn/v1/ */
class SiliconFlowFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createSiliconFlow(apiKey, baseURL);
        return { chat: client.chat, embed: client.embed, model: client.model };
    }
}

/** baseURL = https://dashscope.aliyuncs.com/compatible-mode/v1/ */
class QwenFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createQwen(apiKey, baseURL);
        return { chat: client.chat, embed: client.embed, model: client.model };
    }
}

// --- 工厂注册表 ---

class FactoryRegistry {
    private factories = new Map<string, IProviderFactory>();

    constructor() {
        this.registerDefaults();
    }

    private registerDefaults(): void {
        this.register("OpenAI", new OpenAIFactory());
        this.register("OpenAI Compatible", new OpenAIFactory());
        this.register("Ollama", new OllamaFactory());
        this.register("Anthropic", new AnthropicFactory());
        this.register("Fireworks", new FireworksFactory());
        this.register("DeepSeek", new DeepSeekFactory());
        this.register("Google Gemini", new GoogleGenerativeAIFactory());
        this.register("LM Studio", new LMStudioFactory());
        this.register("Workers AI", new WorkersAIFactory());
        this.register("Zhipu", new ZhipuFactory());
        this.register("Silicon Flow", new SiliconFlowFactory());
        this.register("Qwen", new QwenFactory());
    }

    public register(type: ProviderType, factory: IProviderFactory): void {
        if (this.factories.has(type)) {
            console.warn(`[FactoryRegistry] Provider factory for type "${type}" is being overridden.`);
        }
        this.factories.set(type, factory);
    }

    public get(type: string): IProviderFactory | undefined {
        return this.factories.get(type);
    }

    public listRegisteredTypes(): string[] {
        return Array.from(this.factories.keys());
    }
}

/**
 * 全局唯一的提供商工厂注册实例。
 * 新增 Provider 类型时，只需在此处调用 `ProviderFactoryRegistry.register(...)` 即可。
 */
export const ProviderFactoryRegistry = new FactoryRegistry();
