import { Schema } from "koishi";

// Embedding 配置接口
export interface EmbeddingConfig {
    Enabled: boolean;
    BaseURL?: string;
    APIKey?: string;
    Model?: string;
}

// Embedding 配置 Schema
export const EmbeddingConfig: Schema<EmbeddingConfig> = Schema.intersect([
    Schema.object({
        Enabled: Schema.boolean()
            .default(false)
            .description("是否启用向量嵌入功能"),
    }),
    Schema.union([
        Schema.object({
            Enabled: Schema.const(true).required(),
            BaseURL: Schema.string()
                .default("https://api.openai.com/v1/embeddings")
                .description("Embedding API 服务地址"),
            APIKey: Schema.string()
                .role("secret")
                .required()
                .description("Embedding API 访问令牌"),
            Model: Schema.string()
                .default("text-embedding-3-large")
                .description("要使用的嵌入模型 ID"),
        }),
        Schema.object({
            Enabled: Schema.const(false),
        }),
    ]),
]).description("Embedding 配置");
