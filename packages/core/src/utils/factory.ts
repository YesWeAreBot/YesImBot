import { CloudflareAdapter, CustomAdapter, GeminiAdapter, OllamaAdapter, OpenAIAdapter } from "../adapters";
import { BaseAdapter } from "../adapters/base";
import { Config, LLMConfig } from "../adapters/config";


export function getAdapter(config: LLMConfig, parameters?: Config["Parameters"]): BaseAdapter {
    // 将 APIType 映射到对应的 Adapter 类
    const adapterMap: { [key: string]: new (config: LLMConfig, parameters?: Config["Parameters"]) => BaseAdapter } = {
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
    throw new InvalidAdapterTypeError(`不支持的 API 类型: ${config.APIType}`);
}

class InvalidAdapterTypeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidAPITypeError";
    }
}
