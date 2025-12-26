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
import { createSharedFetch, normalizeBaseURL } from "./utils";

export * from "./classifier";
export * from "./types";
export * from "./utils";
export * from "@xsai-ext/providers";
export * from "@xsai-ext/providers/create";
export * from "xsai";

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
    baseURL: string;
    apiKey: string;
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

/* prettier-ignore */
export type UnionProvider
    = | ChatProvider<any>
        | EmbedProvider<any>
        | ImageProvider<any>
        | SpeechProvider<any>
        | TranscriptionProvider<any>;

export interface ProviderRuntime {
    fetch?: AnyFetch;
    proxy?: string;
    logger?: any;
}

export abstract class SharedProvider<TProvider extends UnionProvider = ChatProvider<any>, TModelConfig = {}> {
    public readonly name: string;
    protected readonly config: SharedConfig<TModelConfig>;

    /* prettier-ignore */
    protected fetch: AnyFetch
        = typeof globalThis.fetch === "function" ? globalThis.fetch : (ufetch as unknown as AnyFetch);

    protected readonly logger: any;
    private readonly shouldInjectFetch: boolean;

    constructor(
        name: string,
        config: SharedConfig<TModelConfig>,
        protected readonly provider: UnionProvider,
        runtime?: ProviderRuntime,
    ) {
        this.name = name;
        this.config = config;
        this.logger = runtime?.logger;

        this.fetch = createSharedFetch({
            fetch: runtime?.fetch,
            proxy: runtime?.proxy,
            retry: config.retry,
            retryDelay: config.retryDelay,
        });

        this.shouldInjectFetch = Boolean((config.retry && config.retry > 0) || runtime?.fetch || runtime?.proxy);

        // 运行时绑定方法
        const methods = ["chat", "embed", "image", "speech", "transcription"] as const;

        const getOverride = (modelId: string): Partial<TModelConfig> => {
            const override = (this.config as SharedConfig<TModelConfig>).override;
            return override && override[modelId] ? override[modelId]! : {};
        };

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

    /* prettier-ignore */
    model: TProvider extends ModelProvider ? () => Omit<CommonRequestOptions, "model"> & TModelConfig : never
        = undefined as any;

    public async getOnlineModels(): Promise<string[]> {
        const baseURL = normalizeBaseURL(this.config.baseURL);
        if (!baseURL) {
            throw new Error("无法获取在线模型列表：缺少 baseURL 配置");
        }

        const url = `${baseURL}/models`;

        const response = await this.fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${this.config.apiKey}` },
        });
        if (!response.ok) {
            throw new Error(`获取在线模型列表失败，状态码：${response.status}，URL：${url}`);
        }
        const data = await response.json();
        return data.data.map((item: any) => item.id) as string[];
    }
}
