import { Schema } from "koishi";

export interface EmbeddingConfig {
    Enabled: boolean;
    BaseURL?: string;
    APIKey?: string;
    Model?: string;
}

export const EmbeddingConfig: Schema<EmbeddingConfig> = Schema.intersect([
    Schema.object({
        Enabled: Schema.boolean().default(false).description("是否启用 Embedding"),
    }).description("Embedding 配置"),
    Schema.union([
        Schema.object({
            Enabled: Schema.const(true).required(),
            BaseURL: Schema.string()
                .default("https://api.openai.com/v1/embeddings")
                .description("Embedding API 基础 URL"),
            APIKey: Schema.string().description("API 令牌"),
            Model: Schema.string()
                .default("text-embedding-3-large")
                .description("Embedding 模型 ID"),
        }),
        Schema.object({
            Enabled: Schema.const(false),
        }),
    ]),
]);
