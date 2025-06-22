import type { ChatProvider, EmbedProvider, ImageProvider, SpeechProvider, TranscriptionProvider } from "@xsai-ext/shared-providers";
import { ProviderConfig } from "../types";

/**
 * @interface IProviderClient
 * @description 定义了一个 LLM Provider 客户端的统一结构。
 * 这是所有具体客户端实例（如 OpenAI 客户端、Ollama 客户端）都必须满足的契约。
 * 它可能包含聊天、嵌入、图像生成等多种能力。
 * 属性是可选的，因为并非所有 Provider都支持所有功能。
 */
export interface IProviderClient {
    chat?: ChatProvider;
    embed?: EmbedProvider;
    image?: ImageProvider;
    speech?: SpeechProvider;
    transcript?: TranscriptionProvider;
}

/**
 * @interface IProviderFactory
 * @description 定义了创建 IProviderClient 实例的工厂的统一接口。
 * 每种类型的 Provider (e.g., "OpenAI", "Ollama") 都会有一个对应的工厂实现这个接口。
 */
export interface IProviderFactory {
    /**
     * 根据传入的配置，创建一个具体的 Provider 客户端实例。
     * @param config - Provider 的配置，包含 APIKey, BaseURL 等。
     * @returns 一个实现了 IProviderClient 接口的对象。
     */
    createClient(config: ProviderConfig): IProviderClient;
}
