import { CloudflareAdapter, CustomAdapter, GeminiAdapter, OllamaAdapter, OpenAIAdapter } from "../adapters";
import { BaseAdapter } from "../adapters/base";
import { LLM } from "../adapters/config";
import { Config } from "../config";
import { CustomEmbedding, OllamaEmbedding, OpenAIEmbedding } from "../embeddings";
import { EmbeddingBase } from "../embeddings/base";
import { EnabledEmbeddingConfig } from "../embeddings/config";
import { CacheManager } from "../managers/cacheManager";

export function getAdapter(config: LLM, parameters?: Config["Parameters"]): BaseAdapter {
    // 将 APIType 映射到对应的 Adapter 类
    const adapterMap: { [key: string]: new (config: LLM, parameters?: Config["Parameters"]) => BaseAdapter } = {
        "Cloudflare": CloudflareAdapter,
        "Custom URL": CustomAdapter,
        "Ollama": OllamaAdapter,
        "OpenAI": OpenAIAdapter,
        "Gemini": GeminiAdapter,
    };
    const AdapterClass = adapterMap[config.APIType];
    if (AdapterClass) {
        return new AdapterClass(config, parameters);
    }
    throw new Error(`不支持的 API 类型: ${config.APIType}`);
}

export function getEmbedding(config: EnabledEmbeddingConfig, manager?: CacheManager<number[]>) {
    // 将 APIType 映射到对应的 Embedding 类
    const embeddingMap: { [key: string]: new (config: EnabledEmbeddingConfig, manager?: CacheManager<number[]>) => EmbeddingBase } = {
        "OpenAI": OpenAIEmbedding,
        "Ollama": OllamaEmbedding,
        "Custom": CustomEmbedding,
    };
    const EmbeddingClass = embeddingMap[config.APIType];
    if (EmbeddingClass) {
        return new EmbeddingClass(config, manager);
    }
    throw new Error(`不支持的 Embedding 类型: ${config.APIType}`);
}
