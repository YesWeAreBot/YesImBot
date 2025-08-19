import { Schema } from "koishi";
import { SystemConfig } from "../../config";

/** 模型切换策略 */
export enum ModelSwitchingStrategy {
    Failover = "failover", // 故障转移 (默认)
    RoundRobin = "round-robin", // 轮询
}

/** 内容验证失败时的处理动作 */
export enum ContentFailureAction {
    FailoverToNext = "failover_to_next", // 立即切换到下一个模型
    AugmentAndRetry = "augment_and_retry", // 增强提示词并在当前模型重试
}

/** 定义超时策略 */
export interface TimeoutPolicy {
    /** 首次响应超时 (秒) */
    firstTokenTimeout?: number;
    /** 总请求超时 (秒) */
    totalTimeout: number;
}

/** 定义重试策略 */
export interface RetryPolicy {
    /** 最大重试次数 (在同一模型上) */
    maxRetries: number;
    /** 内容验证失败时的动作 */
    onContentFailure: ContentFailureAction;
}

/** 定义断路器策略 */
export interface CircuitBreakerPolicy {
    /** 触发断路的连续失败次数 */
    failureThreshold: number;
    /** 断路器开启后的冷却时间 (秒) */
    cooldownSeconds: number;
}

// =================================================================
// 1. 核心与共享类型 (Core & Shared Types)
// =================================================================

/** 定义模型支持的能力 */
export enum ModelAbility {
    Vision = "视觉",
    WebSearch = "网络搜索",
    Reasoning = "推理",
    FunctionCalling = "函数调用",
    Embedding = "嵌入",
    Chat = "对话",
}

/**
 * @enum TaskType
 * @description 定义了系统中的核心AI任务类型，用于类型安全地分配模型组。
 */
export enum TaskType {
    Chat = "chat",
    Embedding = "embed",
    Summarization = "summarize",
    Memory = "memory",
}

/** 描述一个模型在特定提供商中的位置 */
export type ModelDescriptor = {
    providerName: string;
    modelId: string;
};

// =================================================================
// 2. 配置项 - 按UI逻辑分组
// =================================================================

export interface ModelConfig {
    providerName?: string;
    modelId: string;
    abilities: ModelAbility[];
    parameters?: {
        temperature?: number;
        topP?: number;
        stream?: boolean;
        custom?: Array<{ key: string; type: "string" | "number" | "boolean" | "object"; value: string }>;
    };
    /** 超时策略 */
    timeoutPolicy?: TimeoutPolicy;
    /** 重试策略 */
    retryPolicy?: RetryPolicy;
    /** 断路器策略 */
    circuitBreakerPolicy?: CircuitBreakerPolicy;
}

export const ModelConfigSchema: Schema<ModelConfig> = Schema.object({
    modelId: Schema.string().required().description("模型ID"),
    abilities: Schema.array(
        Schema.union([
            ModelAbility.Chat,
            ModelAbility.Vision,
            ModelAbility.WebSearch,
            ModelAbility.Reasoning,
            ModelAbility.FunctionCalling,
            ModelAbility.Embedding,
        ])
    )
        .role("checkbox")
        .default([ModelAbility.Chat, ModelAbility.FunctionCalling])
        .description("模型支持的能力"),

    parameters: Schema.object({
        temperature: Schema.number().default(0.85),
        topP: Schema.number().default(0.95),
        stream: Schema.boolean().default(true).description("流式传输"),
        custom: Schema.array(
            Schema.object({
                key: Schema.string().required(),
                type: Schema.union(["string", "number", "boolean", "object"]).default("string"),
                value: Schema.string().required(),
            })
        )
            .role("table")
            .description("自定义参数"),
    }),

    timeoutPolicy: Schema.object({
        firstTokenTimeout: Schema.number().default(15).description("首字响应超时 (秒)"),
        totalTimeout: Schema.number().default(60).description("总请求超时 (秒)"),
    }).description("超时策略"),

    retryPolicy: Schema.object({
        maxRetries: Schema.number().default(1).description("在切换到下一个模型前，在当前模型上的最大重试次数"),
        onContentFailure: Schema.union([
            Schema.const(ContentFailureAction.FailoverToNext).description("立即切换"),
            Schema.const(ContentFailureAction.AugmentAndRetry).description("修正Prompt并重试"),
        ])
            .default(ContentFailureAction.AugmentAndRetry)
            .description("响应内容无效时的处理方式"),
    }).description("重试策略"),

    circuitBreakerPolicy: Schema.object({
        failureThreshold: Schema.number().default(3).description("连续失败多少次后开启断路器"),
        cooldownSeconds: Schema.number().default(300).description("断路器开启后，模型被禁用的时长(秒)"),
    }).description("断路器策略"),
})
    .collapse()
    .description("单个模型配置");

const PROVIDERS = {
    OpenAI: { baseURL: "https://api.openai.com/v1/", link: "https://platform.openai.com/account/api-keys" },
    "OpenAI Compatible": { baseURL: "https://api.openai.com/v1/", link: "https://platform.openai.com/account/api-keys" },
    Anthropic: { baseURL: "https://api.anthropic.com/v1/", link: "https://console.anthropic.com/settings/keys" },
    Fireworks: { baseURL: "https://api.fireworks.ai/inference/v1/", link: "https://console.fireworks.ai/api-keys" },
    DeepSeek: { baseURL: "https://api.deepseek.com/", link: "https://platform.deepseek.com/api_keys" },
    "Google Gemini": {
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
        link: "https://aistudio.google.com/app/apikey",
    },
    "LM Studio": { baseURL: "http://localhost:5000/v1/", link: "https://lmstudio.ai/docs/app/api/endpoints/openai" },
    "Workers AI": { baseURL: "https://api.cloudflare.com/client/v4/", link: "https://dash.cloudflare.com/?to=/:account/workers-ai" },
    Zhipu: { baseURL: "https://open.bigmodel.cn/api/paas/v4/", link: "https://open.bigmodel.cn/usercenter/apikeys" },
    "Silicon Flow": { baseURL: "https://api.siliconflow.cn/v1/", link: "https://console.siliconflow.cn/account/key" },
    Qwen: { baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1/", link: "https://dashscope.console.aliyun.com/apiKey" },
    Ollama: { baseURL: "http://localhost:11434/v1/", link: "https://ollama.com/" },
    // "Azure OpenAI": {
    //     baseURL: "https://<resource-name>.services.ai.azure.com/models/",
    //     link: "https://oai.azure.com/",
    // },
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

export const PROVIDER_TYPES = Object.keys(PROVIDERS) as ProviderType[];

export type ProviderType = keyof typeof PROVIDERS;

export interface ProviderConfig {
    name: string;
    enabled?: boolean;
    type: ProviderType;
    baseURL?: string;
    apiKey: string;
    proxy?: string;
    models: ModelConfig[];
}

export const ProviderConfigSchema: Schema<ProviderConfig> = Schema.intersect([
    Schema.object({
        name: Schema.string().required().description("提供商名称"),
        enabled: Schema.boolean().default(true).description("是否启用"),
        type: Schema.union(PROVIDER_TYPES).default("OpenAI").description("提供商类型"),
    }),
    Schema.union(
        PROVIDER_TYPES.map((type) => {
            return Schema.object({
                type: Schema.const(type),
                baseURL: Schema.string().default(PROVIDERS[type].baseURL).role("link").description(`提供商的 API 地址`),
                apiKey: Schema.string()
                    .role("secret")
                    .description(`提供商的 API 密钥${PROVIDERS[type].link ? ` (获取地址 - ${PROVIDERS[type].link})` : ""}`),
                proxy: Schema.string().description("代理地址"),
                models: Schema.array(ModelConfigSchema).required().description("模型列表"),
            });
        })
    ),
])
    .collapse()
    .description("提供商配置");

export interface ModelServiceConfig {
    providers: ProviderConfig[];
    modelGroups: { name: string; models: ModelDescriptor[]; strategy: ModelSwitchingStrategy }[];
    task: {
        [TaskType.Chat]: string;
        [TaskType.Embedding]: string;
    };
    readonly system?: SystemConfig;
}

export const ModelServiceConfigSchema: Schema<ModelServiceConfig> = Schema.object({
    providers: Schema.array(ProviderConfigSchema).required().role("table").description("配置你的 AI 模型提供商，如 OpenAI, Anthropic 等"),
    modelGroups: Schema.array(
        Schema.object({
            name: Schema.string().required().description("模型组名称"),
            strategy: Schema.union([
                Schema.const(ModelSwitchingStrategy.Failover).description("故障转移"),
                Schema.const(ModelSwitchingStrategy.RoundRobin).description("轮询/负载均衡"),
            ])
                .default(ModelSwitchingStrategy.Failover)
                .description("模型切换策略"),
            models: Schema.array(Schema.dynamic("modelService.selectableModels"))
                .required()
                .role("table")
                .description("此模型组包含的模型"),
        }).collapse()
    )
        .role("table")
        .description("**［必填］** 创建**模型组**，用于故障转移或分类。每次修改模型配置后，需要先启动/重载一次插件来修改此处的值"),
    task: Schema.object({
        [TaskType.Chat]: Schema.dynamic("modelService.availableGroups").description(
            "主要聊天功能使用的模型**组**<br/>如 `gpt-4` `claude-3` `gemini-2.5` 等对话模型"
        ),
        [TaskType.Embedding]: Schema.dynamic("modelService.availableGroups").description(
            "生成文本嵌入(Embedding)时使用的模型**组**<br/>如 `bge-m3` `text-embedding-3-small` 等嵌入模型"
        ),
    }).description("为不同核心任务分配一个模型组"),
});
