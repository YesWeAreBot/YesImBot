import { Schema } from "koishi";
import { ModelAbility, ModelType, SwitchStrategy } from "./types";

// --- 1. 常量与核心类型定义 (Constants & Core Types) ---

/**
 * 预设的 AI 模型提供商及其默认配置。
 * @internal
 */
const PROVIDERS = {
    OpenAI: { baseURL: "https://api.openai.com/v1/", link: "https://platform.openai.com/account/api-keys" },
    "OpenAI Compatible": { baseURL: "https://api.openai.com/v1/", link: "https://platform.openai.com/account/api-keys" },
    Anthropic: { baseURL: "https://api.anthropic.com/v1/", link: "https://console.anthropic.com/settings/keys" },
    Fireworks: { baseURL: "https://api.fireworks.ai/inference/v1/", link: "https://console.fireworks.ai/api-keys" },
    DeepSeek: { baseURL: "https://api.deepseek.com/", link: "https://platform.deepseek.com/api_keys" },
    "Google Gemini": {
        baseURL: "https://generativelanguage.googleapis.com/v1beta/",
        link: "https://aistudio.google.com/app/apikey",
    },
    "LM Studio": { baseURL: "http://localhost:5000/v1/", link: "https://lmstudio.ai/docs/app/api/endpoints/openai" },
    "Workers AI": { baseURL: "https://api.cloudflare.com/client/v4/", link: "https://dash.cloudflare.com/?to=/:account/workers-ai" },
    Zhipu: { baseURL: "https://open.bigmodel.cn/api/paas/v4/", link: "https://open.bigmodel.cn/usercenter/apikeys" },
    "Silicon Flow": { baseURL: "https://api.siliconflow.cn/v1/", link: "https://console.siliconflow.cn/account/key" },
    Qwen: { baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1/", link: "https://dashscope.console.aliyun.com/apiKey" },
    Ollama: { baseURL: "http://localhost:11434/v1/", link: "https://ollama.com/" },
    Cerebras: { baseURL: "https://api.cerebras.ai/v1/", link: "https://inference-docs.cerebras.ai/api-reference/chat-completions" },
    DeepInfra: { baseURL: "https://api.deepinfra.com/v1/openai/", link: "https://deepinfra.com/dash/api_keys" },
    "Fatherless AI": { baseURL: "https://api.featherless.ai/v1/", link: "https://featherless.ai/login" },
    Groq: { baseURL: "https://api.groq.com/openai/v1/", link: "https://console.groq.com/keys" },
    Minimax: { baseURL: "https://api.minimax.chat/v1/", link: "https://platform.minimaxi.com/api-key" },
    "Minimax (International)": { baseURL: "https://api.minimaxi.chat/v1/", link: "https://www.minimax.io/user-center/api-keys" },
    Mistral: { baseURL: "https://api.mistral.ai/v1/", link: "https://console.mistral.ai/api-keys/" },
    Moonshot: { baseURL: "https://api.moonshot.cn/v1/", link: "https://platform.moonshot.cn/console/api-keys" },
    Novita: { baseURL: "https://api.novita.ai/v3/openai/", link: "https://novita.ai/get-started" },
    OpenRouter: { baseURL: "https://openrouter.ai/api/v1/", link: "https://openrouter.ai/keys" },
    Perplexity: { baseURL: "https://api.perplexity.ai/", link: "https://www.perplexity.ai/settings/api" },
    Stepfun: { baseURL: "https://api.stepfun.com/v1/", link: "https://platform.stepfun.com/my-keys" },
    "Tencent Hunyuan": { baseURL: "https://api.hunyuan.cloud.tencent.com/v1/", link: "https://console.cloud.tencent.com/cam/capi" },
    "Together AI": { baseURL: "https://api.together.xyz/v1/", link: "https://api.together.ai/settings/api-keys" },
    "XAI (Grok)": { baseURL: "https://api.x.ai/v1/", link: "https://docs.x.ai/docs/overview" },
} as const;

export type ProviderType = keyof typeof PROVIDERS;
export const PROVIDER_TYPES = Object.keys(PROVIDERS) as ProviderType[];

/** 描述一个唯一模型的标识符 */
export type ModelDescriptor = {
    providerName: string;
    modelId: string;
};

// --- 2. 模型配置 (Model Configuration) ---

export interface BaseModelConfig {
    modelId: string;
    modelType: ModelType;
}

export interface ChatModelConfig extends BaseModelConfig {
    modelType: ModelType.Chat;
    abilities?: ModelAbility[];
    temperature?: number;
    topP?: number;
    stream?: boolean;
    custom?: Array<{ key: string; type: "string" | "number" | "boolean" | "json"; value: string }>;
}

export type ModelConfig = BaseModelConfig | ChatModelConfig;

/**
 * Schema for a single model configuration.
 */
export const ModelConfig: Schema<ModelConfig> = Schema.intersect([
    Schema.object({
        modelId: Schema.string().required().description("模型 ID (例如 'gpt-4o', 'llama3-70b-8192')"),
        modelType: Schema.union([
            Schema.const(ModelType.Chat).description("聊天"),
            Schema.const(ModelType.Image).description("图像"),
            Schema.const(ModelType.Embedding).description("嵌入"),
        ])
            .default(ModelType.Chat)
            .description("模型类型"),
    }).description("基础模型设置"),

    Schema.union([
        Schema.object({
            modelType: Schema.const(ModelType.Chat),
            abilities: Schema.array(
                Schema.union([
                    Schema.const(ModelAbility.Vision).description("视觉 (识图)"),
                    Schema.const(ModelAbility.FunctionCalling).description("工具调用"),
                    Schema.const(ModelAbility.Reasoning).description("推理"),
                ])
            )
                .default([])
                .role("checkbox")
                .description("模型具备的特殊能力。"),
            temperature: Schema.number().min(0).max(2).step(0.1).default(0.7).description("控制生成文本的随机性，值越高越随机。"),
            topP: Schema.number().min(0).max(1).step(0.05).default(0.95).description("控制生成文本的多样性，也称为核采样。"),
            stream: Schema.boolean().default(true).description("是否启用流式传输，以获得更快的响应体验。"),
            custom: Schema.array(
                Schema.object({
                    key: Schema.string().required().description("参数键"),
                    type: Schema.union(["string", "number", "boolean", "json"]).default("string").description("值类型"),
                    value: Schema.string().required().description("参数值"),
                })
            )
                .role("table")
                .description("自定义请求参数，用于支持特定提供商的非标准 API 字段。"),
        }),
        Schema.object({ modelType: Schema.const(ModelType.Image) }),
        Schema.object({ modelType: Schema.const(ModelType.Embedding) }),
    ]),
]).collapse();

// --- 3. 提供商配置 (Provider Configuration) ---

export interface ProviderConfig {
    name: string;
    type: ProviderType;
    baseURL?: string;
    apiKey: string;
    proxy?: string;
    models: ModelConfig[];
}

/**
 * Schema for a single provider configuration.
 */
export const ProviderConfig: Schema<ProviderConfig> = Schema.intersect([
    Schema.object({
        name: Schema.string().required().description("提供商的唯一名称，用于标识。"),
        type: Schema.union(PROVIDER_TYPES).default("OpenAI").description("选择提供商的类型，将自动填充默认设置。"),
    }),
    Schema.union(
        PROVIDER_TYPES.map((type) => {
            const providerInfo = PROVIDERS[type];
            return Schema.object({
                type: Schema.const(type),
                baseURL: Schema.string().default(providerInfo.baseURL).description("API 请求的基地址。"),
                apiKey: Schema.string()
                    .role("secret")
                    .description(`API 密钥。${providerInfo.link ? `[点击获取](${providerInfo.link})` : ""}`),
                proxy: Schema.string().description("请求使用的代理地址 (例如 'http://localhost:7890')。"),
                models: Schema.array(ModelConfig).required().description("此提供商下可用的模型列表。"),
            });
        })
    ),
])
    .collapse()
    .description("AI 模型提供商配置");

// --- 4. 切换策略配置 (Switch Strategy Configuration) ---

export interface SharedSwitchConfig {
    /** 切换策略 */
    strategy: SwitchStrategy;
    firstToken: number;
    /** 请求超时时间(ms) */
    requestTimeout: number;
    /** 最大失败重试次数 */
    maxRetries: number;
    /** 单个模型在进入冷却前允许的最大连续失败次数 */
    maxFailures: number;
    /** 失败冷却时间(ms) */
    failureCooldown: number;
    /** 熔断阈值 */
    circuitBreakerThreshold: number;
    /** 熔断恢复时间(ms) */
    circuitBreakerRecoveryTime: number;
}

interface FailoverStrategyConfig extends SharedSwitchConfig {
    strategy: SwitchStrategy.Failover;
}

interface RoundRobinStrategyConfig extends SharedSwitchConfig {
    strategy: SwitchStrategy.RoundRobin;
}

interface RandomStrategyConfig extends SharedSwitchConfig {
    strategy: SwitchStrategy.Random;
}

interface WeightedRandomStrategyConfig extends SharedSwitchConfig {
    strategy: SwitchStrategy.WeightedRandom;
    /** 模型权重配置 */
    modelWeights: Record<string, number>;
}

export type StrategyConfig =
    | SharedSwitchConfig
    | FailoverStrategyConfig
    | RoundRobinStrategyConfig
    | RandomStrategyConfig
    | WeightedRandomStrategyConfig;

/**
 * Schema for model switching and failover strategies.
 */
export const SwitchConfig: Schema<StrategyConfig> = Schema.intersect([
    Schema.object({
        strategy: Schema.union([
            Schema.const(SwitchStrategy.Failover).description("故障转移：按顺序尝试，失败后切换到下一个。"),
            Schema.const(SwitchStrategy.RoundRobin).description("轮询：按顺序循环使用每个模型。"),
            Schema.const(SwitchStrategy.Random).description("随机：每次请求随机选择一个模型。"),
            Schema.const(SwitchStrategy.WeightedRandom).description("加权随机：根据设定的权重随机选择模型。"),
        ])
            .default(SwitchStrategy.Failover)
            .description("模型组的负载均衡与故障切换策略。"),
        firstToken: Schema.number().min(1000).default(30000).description("首字到达时的超时时间 (毫秒)。"),
        requestTimeout: Schema.number().min(1000).default(60000).description("单次请求的超时时间 (毫秒)。"),
        maxRetries: Schema.number().min(1).default(3).description("最大重试次数。"),

        maxFailures: Schema.number().min(1).default(3).description("单个模型在进入冷却前允许的最大连续失败次数。"),
        failureCooldown: Schema.number().min(1000).default(60000).description("模型失败后，暂时禁用的冷却时间 (毫秒)。"),
        circuitBreakerThreshold: Schema.number().min(1).default(5).description("触发熔断的连续失败次数阈值。"),
        circuitBreakerRecoveryTime: Schema.number().min(0).default(300000).description("熔断后，模型自动恢复服务的等待时间 (毫秒)。"),
    }).description("切换策略"),
    Schema.union([
        Schema.object({
            strategy: Schema.const(SwitchStrategy.Failover),
        }),
        Schema.object({
            strategy: Schema.const(SwitchStrategy.RoundRobin),
        }),
        Schema.object({
            strategy: Schema.const(SwitchStrategy.Random),
        }),
        Schema.object({
            strategy: Schema.const(SwitchStrategy.WeightedRandom),
            modelWeights: Schema.dict(Schema.number().min(0).default(1).description("权重"))
                .role("table")
                .description("为每个模型设置权重，权重越高被选中的概率越大。"),
        }),
    ]),
]);

// --- 5. 主服务配置 (Main Service Configuration) ---

export interface ModelServiceConfig {
    providers: ProviderConfig[];
    modelGroups: { name: string; models: ModelDescriptor[] }[];
    chatModelGroup?: string;
    embeddingModel?: ModelDescriptor;
    switchConfig: StrategyConfig;
}

/**
 * Schema for the main Model Service configuration.
 */
export const ModelServiceConfig: Schema<ModelServiceConfig> = Schema.object({
    providers: Schema.array(ProviderConfig).role("table").description("管理和配置所有 AI 模型提供商，例如 OpenAI、Anthropic 等。"),

    modelGroups: Schema.array(
        Schema.object({
            name: Schema.string().required().description("模型组的唯一名称。"),
            models: Schema.array(Schema.dynamic("modelService.selectableModels"))
                .required()
                .role("table")
                .description("选择要加入此模型组的模型。"),
        }).collapse()
    )
        .role("table")
        .description("将不同提供商的模型组合成逻辑分组，用于故障转移或按需调用。注意：修改提供商模型后，需重启插件以刷新可选模型列表。"),

    chatModelGroup: Schema.dynamic("modelService.availableGroups").description("选择一个模型组作为默认的聊天服务。"),

    embeddingModel: Schema.dynamic("modelService.embeddingModels").description(
        "指定用于生成文本嵌入 (Embedding) 的特定模型，例如 'bge-m3' 或 'text-embedding-3-small'。"
    ),

    switchConfig: SwitchConfig,
}).description("模型服务核心配置");
