import type {
    ChatProvider,
    EmbedProvider,
    ImageProvider,
    ModelProvider,
    SpeechProvider,
    TranscriptionProvider,
} from "@xsai-ext/shared-providers";
import type { RequestInit } from "undici";
import type { CommonRequestOptions } from "xsai";
import { fetch, ProxyAgent } from "undici";

export * from "@xsai-ext/providers";
export * from "@xsai-ext/providers/create";
export * from "xsai";
export { createFetch } from "xsfetch";

export function useProxy(proxy: string): typeof globalThis.fetch {
    return function (url: string, options?: RequestInit): Promise<Response> {
        const agent = new ProxyAgent(proxy);
        const init: RequestInit = options || {};
        init.dispatcher = agent;
        return fetch(url, init) as Promise<Response>;
    } as typeof globalThis.fetch;
}

export interface EmbedConfig {
    dimension?: number;
}

export interface ChatModelConfig {
    frequencyPenalty?: number;
    presencePenalty?: number;
    seed?: number;
    stop?: [string, string, string, string] | [string, string, string] | [string, string] | [string] | string;
    temperature?: number;
    topP?: number;
}

export interface SharedConfig<ModelConfig> {
    retry?: number;
    retryDelay?: number;
    modelConfig?: ModelConfig;
}

type ExtractChatModels<T> = T extends ChatProvider<infer M> ? M : never;
type ExtractEmbedModels<T> = T extends EmbedProvider<infer M> ? M : never;
type ExtractImageModels<T> = T extends ImageProvider<infer M> ? M : never;
type ExtractSpeechModels<T> = T extends SpeechProvider<infer M> ? M : never;
type ExtractTranscriptionModels<T> = T extends TranscriptionProvider<infer M> ? M : never;
type UnionProvider
    = | ChatProvider<any>
        | EmbedProvider<any>
        | ImageProvider<any>
        | SpeechProvider<any>
        | TranscriptionProvider<any>;

export abstract class SharedProvider<TProvider extends UnionProvider, TModelConfig = {}> {
    public readonly name: string;

    constructor(
        name: string,
        protected readonly provider: TProvider,
        protected readonly config: SharedConfig<TModelConfig>,
    ) {
        this.name = name;

        // 运行时绑定方法
        const methods = ["chat", "embed", "image", "speech", "transcription"] as const;

        methods.forEach((method) => {
            if (method in provider && typeof (provider as any)[method] === "function") {
                (this as any)[method] = (model: string) => ({
                    ...(provider as any)[method](model),
                    ...this.config.modelConfig,
                });
            }
        });

        if ("model" in provider && typeof (provider as any).model === "function") {
            (this as any).model = () => ({
                ...(provider as any).model(),
                ...this.config.modelConfig,
            });
        }
    }

    // 条件方法定义
    chat: TProvider extends ChatProvider<infer T>
        ? (model: T | (string & {})) => CommonRequestOptions & TModelConfig
        : never = undefined as any;

    embed: TProvider extends EmbedProvider<infer T>
        ? (model: T | (string & {})) => CommonRequestOptions & TModelConfig
        : never = undefined as any;

    image: TProvider extends ImageProvider<infer T>
        ? (model: T | (string & {})) => CommonRequestOptions & TModelConfig
        : never = undefined as any;

    speech: TProvider extends SpeechProvider<infer T>
        ? (model: T | (string & {})) => CommonRequestOptions & TModelConfig
        : never = undefined as any;

    transcription: TProvider extends TranscriptionProvider<infer T>
        ? (model: T | (string & {})) => CommonRequestOptions & TModelConfig
        : never = undefined as any;

    model: TProvider extends ModelProvider ? () => Omit<CommonRequestOptions, "model"> & TModelConfig : never
        = undefined as any;
}
