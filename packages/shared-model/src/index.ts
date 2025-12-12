import type {
    ChatProvider,
    EmbedProvider,
    ImageProvider,
    ModelProvider,
    SpeechProvider,
    TranscriptionProvider,
} from "@xsai-ext/shared-providers";
import type { CommonRequestOptions } from "xsai";
import type { AnyFetch } from "./utils";
import { fetch as ufetch } from "undici";

import { createFetch } from "xsfetch";
import { createSharedFetch } from "./utils";

export * from "./koishi-schema";
export * from "./utils";
export * from "@xsai-ext/providers";
export * from "@xsai-ext/providers/create";

export * from "xsai";
export { createFetch } from "xsfetch";

// Kept for backward compatibility: prefer `createSharedFetch()` from `./utils`.
export function useProxy(proxy: string): typeof globalThis.fetch {
    return createSharedFetch({ proxy }) as typeof globalThis.fetch;
}

export enum ModelType {
    Chat = "chat",
    Embed = "embed",
    Image = "image",
    Speech = "speech",
    Transcription = "transcription",
    Unknown = "unknown",
}

export interface ModelInfo {
    providerName: string;
    modelId: string;
    modelType: ModelType;
}

export enum ChatModelAbility {
    ImageInput = "image-input",
    ObjectGeneration = "object-generation",
    ToolUsage = "tool-usage",
    ToolStreaming = "tool-streaming",
    Reasoning = "reasoning",
    WebSearch = "web-search",
}

export interface ChatModelInfo extends ModelInfo {
    modelType: ModelType.Chat;
    abilities?: ChatModelAbility[];
}

export interface EmbedModelInfo extends ModelInfo {
    modelType: ModelType.Embed;
    dimension: number;
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
    override?: {
        [modelId: string]: Partial<ModelConfig>;
    };
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

export abstract class SharedProvider<TProvider extends UnionProvider = any, TModelConfig = {}> {
    public readonly name: string;

    protected fetch: AnyFetch = (typeof globalThis.fetch === "function" ? globalThis.fetch : (ufetch as unknown as AnyFetch));

    private readonly shouldInjectFetch: boolean;

    constructor(
        name: string,
        protected readonly provider: TProvider,
        protected readonly config: SharedConfig<TModelConfig>,
        runtime?: { fetch?: AnyFetch; proxy?: string },
    ) {
        this.name = name;

        this.fetch = createSharedFetch({
            fetch: runtime?.fetch,
            proxy: runtime?.proxy,
            retry: config.retry,
            retryDelay: config.retryDelay,
        });

        this.shouldInjectFetch = Boolean((config.retry && config.retry > 0) || runtime?.fetch || runtime?.proxy);

        const getOverride = (modelId: string): Partial<TModelConfig> => {
            const override = (this.config as SharedConfig<TModelConfig>).override;
            return (override && override[modelId]) ? override[modelId]! : {};
        };

        // 运行时绑定方法
        const methods = ["chat", "embed", "image", "speech", "transcription"] as const;

        methods.forEach((method) => {
            if (method in provider && typeof (provider as any)[method] === "function") {
                (this as any)[method] = (model: string) => ({
                    ...(provider as any)[method](model),
                    ...(this.shouldInjectFetch ? { fetch: this.fetch } : {}),
                    ...(this.config.modelConfig ?? {}),
                    ...getOverride(model),
                });
            }
        });

        if ("model" in provider && typeof (provider as any).model === "function") {
            (this as any).model = () => ({
                ...(provider as any).model(),
                ...(this.shouldInjectFetch ? { fetch: this.fetch } : {}),
                ...(this.config.modelConfig ?? {}),
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
