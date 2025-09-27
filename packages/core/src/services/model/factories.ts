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
    createAzure,
    createCerebras,
    createDeepInfra,
    createFatherless,
    createGroq,
    createMinimax,
    createMinimaxi,
    createMistral,
    createMoonshot,
    createNovita,
    createOpenRouter,
    createPerplexity,
    createStepfun,
    createTencentHunyuan,
    createTogetherAI,
    createXAI,
} from "@/dependencies/xsai";
import type { ProviderConfig, ProviderType } from "./config";

// --- 接口定义 ---
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

// --- 工厂类 ---

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

class OllamaFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { baseURL } = config;
        const client = createOllama(baseURL);
        return { chat: client.chat, embed: client.embed, model: client.model };
    }
}

class AnthropicFactory implements IProviderFactory {
    public createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createAnthropic(apiKey, baseURL);
        return { chat: client.chat, model: client.model };
    }
}

/**
 * Azure's create function is async. This factory uses a lazy-loading proxy
 * to conform to the synchronous `createClient` interface. The actual client
 * is created on the first API call (e.g., to `.chat` or `.embed`).
 * Requires `resourceName` and optionally `apiVersion` in the config.
 */
// class AzureOpenAIFactory implements IProviderFactory {
//     public createClient(config: ProviderConfig): IProviderClient {
//         let clientPromise: Promise<IProviderClient> | null = null;
//         const getClient = (): Promise<IProviderClient> => {
//             if (!clientPromise) {
//                 const { apiKey, resourceName, apiVersion } = config as ProviderConfig & {
//                     resourceName: string;
//                     apiVersion?: string;
//                 };
//                 if (!resourceName) {
//                     throw new Error("AzureOpenAIFactory: `resourceName` is required in the provider configuration.");
//                 }
//                 clientPromise = createAzure({ apiKey, resourceName, apiVersion });
//             }
//             return clientPromise;
//         };
//         return {
//             chat: async (...args) => (await getClient()).chat!(...args),
//             embed: async (...args) => (await getClient()).embed!(...args),
//             speech: async (...args) => (await getClient()).speech!(...args),
//             transcript: async (...args) => (await getClient()).transcript!(...args),
//             model: async (...args) => (await getClient()).model!(...args),
//         };
//     }
// }

class FireworksFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createFireworks(apiKey, baseURL);
        return { chat: client.chat, embed: client.embed, model: client.model };
    }
}

class DeepSeekFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createDeepSeek(apiKey, baseURL);
        return { chat: client.chat, model: client.model };
    }
}

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

class ZhipuFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createZhipu(apiKey, baseURL);
        return { chat: client.chat, embed: client.embed, model: client.model };
    }
}

class SiliconFlowFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createSiliconFlow(apiKey, baseURL);
        return {
            chat: client.chat,
            embed: client.embed,
            speech: client.speech,
            transcript: client.transcription,
            model: client.model,
        };
    }
}

class QwenFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createQwen(apiKey, baseURL);
        return { chat: client.chat, embed: client.embed, model: client.model };
    }
}

/**
 * Requires `accountId` in the provider configuration.
 * The `baseURL` from config is ignored as it's constructed internally.
 */
class WorkersAIFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, accountId } = config as ProviderConfig & { accountId: string };
        if (!accountId) {
            throw new Error("WorkersAIFactory: `accountId` is required in the provider configuration.");
        }
        const client = createWorkersAI(apiKey, accountId);
        return { chat: client.chat, embed: client.embed };
    }
}

class CerebrasFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createCerebras(apiKey, baseURL);
        return { chat: client.chat, model: client.model };
    }
}

class DeepInfraFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createDeepInfra(apiKey, baseURL);
        return { chat: client.chat, embed: client.embed, model: client.model };
    }
}

class FeatherlessAIFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createFatherless(apiKey, baseURL);
        return { chat: client.chat, model: client.model };
    }
}

class GroqFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createGroq(apiKey, baseURL);
        return { chat: client.chat, transcript: client.transcription, model: client.model };
    }
}

class MinimaxFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createMinimax(apiKey, baseURL);
        return { chat: client.chat };
    }
}

class MinimaxiFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createMinimaxi(apiKey, baseURL);
        return { chat: client.chat };
    }
}

class MistralFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createMistral(apiKey, baseURL);
        return { chat: client.chat, embed: client.embed, model: client.model };
    }
}

class MoonshotFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createMoonshot(apiKey, baseURL);
        return { chat: client.chat, model: client.model };
    }
}

class NovitaFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createNovita(apiKey, baseURL);
        return { chat: client.chat, model: client.model };
    }
}

class OpenRouterFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createOpenRouter(apiKey, baseURL);
        return { chat: client.chat, model: client.model };
    }
}

class PerplexityFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createPerplexity(apiKey, baseURL);
        return { chat: client.chat };
    }
}

class StepfunFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createStepfun(apiKey, baseURL);
        return { chat: client.chat, speech: client.speech, transcript: client.transcription, model: client.model };
    }
}

class TencentHunyuanFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createTencentHunyuan(apiKey, baseURL);
        return { chat: client.chat, embed: client.embed };
    }
}

class TogetherAIFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createTogetherAI(apiKey, baseURL);
        return { chat: client.chat, embed: client.embed, model: client.model };
    }
}

class XAIFactory implements IProviderFactory {
    createClient(config: ProviderConfig): IProviderClient {
        const { apiKey, baseURL } = config;
        const client = createXAI(apiKey, baseURL);
        return { chat: client.chat, model: client.model };
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
        this.register("Zhipu", new ZhipuFactory());
        this.register("Silicon Flow", new SiliconFlowFactory());
        this.register("Qwen", new QwenFactory());
        this.register("Workers AI", new WorkersAIFactory());
        this.register("LM Studio", new LMStudioFactory());
        // this.register("Azure OpenAI", new AzureOpenAIFactory());
        this.register("Cerebras", new CerebrasFactory());
        this.register("DeepInfra", new DeepInfraFactory());
        this.register("Featherless AI", new FeatherlessAIFactory());
        this.register("Groq", new GroqFactory());
        this.register("Minimax", new MinimaxFactory());
        this.register("Minimax (International)", new MinimaxiFactory());
        this.register("Mistral", new MistralFactory());
        this.register("Moonshot", new MoonshotFactory());
        this.register("Novita", new NovitaFactory());
        this.register("OpenRouter", new OpenRouterFactory());
        this.register("Perplexity", new PerplexityFactory());
        this.register("Stepfun", new StepfunFactory());
        this.register("Tencent Hunyuan", new TencentHunyuanFactory());
        this.register("Together AI", new TogetherAIFactory());
        this.register("XAI (Grok)", new XAIFactory());
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

export const ProviderFactoryRegistry = new FactoryRegistry();
