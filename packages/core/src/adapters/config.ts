import { Schema } from "koishi";

export enum Ability {
    Vision = 1 << 0, // 视觉
    WebSearch = 1 << 1, // 联网
    Reasoning = 1 << 2, // 推理
    FunctionCalling = 1 << 3, // 工具
    Embedding = 1 << 4, // 嵌入
}

export interface Model {
    ModelID: string;
    Ability: number;
}

export interface ModelSetting {
    Temperature: number;
    Top_P: number;
    Stream: boolean;
    ToolUseMode: "function" | "prompt";
    CustomParameters: {
        key: string;
        type: "文本" | "数字" | "布尔值" | "JSON";
        value: string;
    }[];
}

export interface Provider {
    Enabled?: boolean;
    Type:
        | "OpenAI"
        | "OpenAI Compatible"
        | "Anthropic"
        | "Google Gemini"
        | "OpenRouter"
        | "SiliconFlow"
        | "XAI"
        | "DeepSeek"
        | "Zhipu"
        | "LMStudio"
        | "Ollama"
        | "Qwen"
        | "Cloudflare WorkersAI";
    BaseURL?: string;
    APIKey: string;
    Models: Model[];
    Proxy?: string;
}

// Embedding 配置接口
export interface EmbeddingConfig {
    Enabled: boolean;
    BaseURL?: string;
    APIKey?: string;
    Model?: string;
}

export const Model: Schema<Model> = Schema.object({
    ModelID: Schema.string().required().description("模型 ID"),
    Ability: Schema.bitset(Ability).default(Ability.FunctionCalling).description("选择模型类型"),
});

export const ModelSetting: Schema<ModelSetting> = Schema.object({
    Temperature: Schema.number()
        .min(0)
        .max(2)
        .default(1.36)
        .role("slider")
        .step(0.01)
        .description(
            "模型温度 | 模型生成文本的随机程度。值越大，回复内容越赋有多样性、创造性、随机性；设为 0 根据事实回答。日常聊天建议设置为 0.7"
        ),
    Top_P: Schema.number()
        .min(0)
        .max(1)
        .default(1)
        .role("slider")
        .step(0.01)
        .description("Top-P | 默认值为 1，值越小，AI 生成的内容越单调，也越容易理解；值越大，AI 回复的词汇围越大，越多样化"),
    Stream: Schema.boolean().default(true).description("流式输出"),
    ToolUseMode: Schema.union(["prompt", "function"]).default("prompt").description("工具调用方式"),
    CustomParameters: Schema.array(
        Schema.object({
            key: Schema.string().required().description("参数名称"),
            type: Schema.union(["文本", "数字", "布尔值", "JSON"]).default("文本").description("参数类型"),
            value: Schema.string().description("参数值"),
        })
    )
        .role("table")
        .description("自定义参数"),
});

export const Provider: Schema<Provider> = Schema.object({
    Enabled: Schema.boolean().default(true).description("是否启用"),
    Type: Schema.union([
        "OpenAI",
        "OpenAI Compatible",
        "Anthropic",
        "Google Gemini",
        "OpenRouter",
        "SiliconFlow",
        "XAI",
        "DeepSeek",
        "Zhipu",
        "LMStudio",
        "Ollama",
        "Qwen",
        "Cloudflare WorkersAI",
    ])
        .default("OpenAI")
        .description("提供商类型"),
    BaseURL: Schema.string().default("https://api.openai.com/v1").description("API 地址"),
    APIKey: Schema.string().required().role("secret").description("API 密钥"),
    Models: Schema.array(Model.collapse(true)).description("模型"),
    Proxy: Schema.string()
        .pattern(
            /^(?:(http[s]?|socks[45]|ftp|ssh):\/\/)?(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])|localhost|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}|[a-zA-Z0-9-]{1,63}\):(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9]\d{0,3})$/i
        )
        .description("代理地址"),
});

// Embedding 配置 Schema
export const EmbeddingConfig: Schema<EmbeddingConfig> = Schema.intersect([
    Schema.object({
        Enabled: Schema.boolean().default(false).description("是否启用向量嵌入功能"),
    }),
    Schema.union([
        Schema.object({
            Enabled: Schema.const(true).required(),
            BaseURL: Schema.string().default("https://api.openai.com/v1/embeddings").description("Embedding API 服务地址"),
            APIKey: Schema.string().role("secret").required().description("Embedding API 访问令牌"),
            Model: Schema.string().default("text-embedding-3-large").description("要使用的嵌入模型 ID"),
        }),
        Schema.object({
            Enabled: Schema.const(false),
        }),
    ]),
]);
