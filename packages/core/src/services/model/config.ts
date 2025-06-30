import { Schema } from "koishi";

export enum Ability {
    Vision = 1 << 0, // 视觉
    WebSearch = 1 << 1, // 联网
    Reasoning = 1 << 2, // 推理
    FunctionCalling = 1 << 3, // 工具
    Embedding = 1 << 4, // 嵌入
}

export interface ModelConfig {
    ModelID: string;
    Ability: number;
    // 模型特定的参数
    Temperature?: number;
    TopP?: number;
    Stream?: boolean;
    CustomParameters?: { key: string; type: "文本" | "数字" | "布尔值" | "JSON"; value: string }[];
}

export interface ProviderConfig {
    Name: string;
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
    Proxy?: string;
    Models: ModelConfig[];
}

export interface ModelServiceConfig {
    Providers: ProviderConfig[];
    ModelGroup: {
        Name: string;
        Models: ModelDescriptor[];
    }[];
    ChatModelGroup: string;
    EmbedModelGroup: string;
    SummarizationModelGroup: string;
}

export type ModelDescriptor = { ProviderName: string; ModelId: string };

export const ModelConfigSchema: Schema<ModelConfig> = Schema.object({
    ModelID: Schema.string().required().description("模型 ID"),
    Ability: Schema.bitset(Ability).default(Ability.FunctionCalling).description("选择模型能力组合"),
    Temperature: Schema.number()
        .min(0)
        .max(2)
        .default(0.7)
        .role("slider")
        .step(0.01)
        .description("模型温度 | 生成文本的随机性，值越大越随机。"),
    TopP: Schema.number().min(0).max(1).default(0.9).role("slider").step(0.01).description("Top-p 采样参数，控制生成文本的多样性"),
    Stream: Schema.boolean().default(true).description("是否启用流式输出"),
    CustomParameters: Schema.array(
        Schema.object({
            key: Schema.string().required().description("参数名"),
            type: Schema.union(["文本", "数字", "布尔值", "JSON"]).default("文本").description("参数类型"),
            value: Schema.string().required().description("参数值"),
        })
    )
        .description("自定义参数（例如：stop、presence_penalty 等）")
        .collapse(),
}).description("模型配置");

export const ProviderConfigSchema: Schema<ProviderConfig> = Schema.object({
    Name: Schema.string().required().description("提供商的唯一名称，例如 'my-openai'"),
    Enabled: Schema.boolean().default(true).description("是否启用此提供商"),
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
    BaseURL: Schema.string().default("https://api.openai.com/v1").description("API 服务地址"),
    APIKey: Schema.string().required().role("secret").description("API 密钥"),
    Models: Schema.array(ModelConfigSchema).description("该提供商下的模型列表"),
    Proxy: Schema.string()
        .pattern(
            /^(?:(http[s]?|socks[45]|ftp|ssh):\/\/)?(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])|localhost|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}|[a-zA-Z0-9-]{1,63}\):(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9]\d{0,3})$/i
        )
        .description("代理地址"),
}).collapse(true);

export const ModelServiceConfigSchema: Schema<ModelServiceConfig> = Schema.object({
    Providers: Schema.array(ProviderConfigSchema).description("模型提供商列表"),
    ModelGroup: Schema.array(
        Schema.object({
            Name: Schema.string().required().description("模型组名称"),
            Models: Schema.array(
                Schema.object({
                    ProviderName: Schema.string().required().description("提供商名称"),
                    ModelId: Schema.string().required().description("模型ID"),
                })
            )
            .role("table")
            .description("该组包含的模型列表"),
        })
    ).description("模型组列表"),
    ChatModelGroup: Schema.string().required().description("默认对话模型组"),
    EmbedModelGroup: Schema.string().required().description("默认嵌入模型组"),
    SummarizationModelGroup: Schema.string().required().description("默认摘要模型组"),
}).description("模型服务全局配置");
