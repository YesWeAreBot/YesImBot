import { Schema } from "koishi";

export enum ModelAbility {
    Vision = "视觉",
    WebSearch = "网络搜索",
    Reasoning = "推理",
    FunctionCalling = "函数调用",
}

export enum ModelType {
    Chat = "Chat",
    Image = "Image",
    Embedding = "Embedding",
}

export type ModelDescriptor = {
    providerName: string;
    modelId: string;
};

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

export const ModelConfigSchema: Schema<ModelConfig> = Schema.intersect([
    Schema.object({
        modelId: Schema.string().required().description("模型ID"),
        modelType: Schema.union([
            Schema.const(ModelType.Chat).description("聊天"),
            Schema.const(ModelType.Image).description("图像"),
            Schema.const(ModelType.Embedding).description("嵌入"),
        ])
            .default(ModelType.Chat)
            .description("模型类型"),
    }).description("模型设置"),

    Schema.union([
        Schema.object({
            modelType: Schema.const(ModelType.Chat),
            abilities: Schema.array(
                Schema.union([
                    Schema.const(ModelAbility.Vision).description("视觉"),
                    Schema.const(ModelAbility.FunctionCalling).description("工具"),
                    Schema.const(ModelAbility.Reasoning).description("推理"),
                ])
            )
                .default([])
                .role("checkbox")
                .description("能力"),
            temperature: Schema.number().default(0.85),
            topP: Schema.number().default(0.95),
            stream: Schema.boolean().default(true).description("流式传输"),
            custom: Schema.array(
                Schema.object({
                    key: Schema.string().required(),
                    type: Schema.union(["string", "number", "boolean", "json"]).default("string"),
                    value: Schema.string().required(),
                })
            )
                .role("table")
                .description("自定义参数"),
        }),
        Schema.object({
            modelType: Schema.const(ModelType.Image),
        }),
        Schema.object({
            modelType: Schema.const(ModelType.Embedding),
        }),
    ]),
]).collapse();

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
    type: ProviderType;
    baseURL?: string;
    apiKey: string;
    proxy?: string;
    models: ModelConfig[];
}

export const ProviderConfigSchema: Schema<ProviderConfig> = Schema.intersect([
    Schema.object({
        name: Schema.string().required().description("提供商名称"),
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
    modelGroups: { name: string; models: ModelDescriptor[] }[];
    chatModelGroup?: string;
    embeddingModel?: ModelDescriptor;
}

export const ModelServiceConfigSchema: Schema<ModelServiceConfig> = Schema.object({
    providers: Schema.array(ProviderConfigSchema).role("table").description("配置你的 AI 模型提供商，如 OpenAI, Anthropic 等"),
    modelGroups: Schema.array(
        Schema.object({
            name: Schema.string().required().description("模型组名称"),
            models: Schema.array(Schema.dynamic("modelService.selectableModels"))
                .required()
                .role("table")
                .description("此模型组包含的模型"),
        }).collapse()
    )
        .role("table")
        .description("**［必填］** 创建**模型组**，用于故障转移或分类。每次修改模型配置后，需要先启动/重载一次插件来修改此处的值"),
    chatModelGroup: Schema.dynamic("modelService.availableGroups").description("主要聊天功能使用的模型**组**"),
    embeddingModel: Schema.dynamic("modelService.embeddingModels").description(
        "生成文本嵌入时使用的模型<br/>如 `bge-m3` `text-embedding-3-small` 等嵌入模型"
    ),
}).description("模型服务配置");
