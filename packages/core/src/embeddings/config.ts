import { Schema } from "koishi";

export interface EnabledEmbeddingConfig {
  Enabled: true;
  BaseURL: string;
  APIKey: string;
  Model: string;
}

export interface DisabledEmbeddingConfig {
  Enabled: false;
}

export type EmbeddingConfig = EnabledEmbeddingConfig | DisabledEmbeddingConfig;

export const EmbeddingConfig: Schema<EmbeddingConfig> = Schema.intersect([
  Schema.object({
    Enabled: Schema.boolean().default(false).description("是否启用 Embedding"),
  }).description("Embedding 配置"),
  Schema.union([
    Schema.intersect([
      Schema.object({
        Enabled: Schema.const(true).required(),
        //BaseURL: Schema.string().description("Embedding API 基础 URL"),
        APIKey: Schema.string().description("API 令牌"),
        Model: Schema.string()
          .default("text-embedding-3-large")
          .description("Embedding 模型 ID"),
      }),
      Schema.union([
        Schema.object({
          Enabled: Schema.const(true),
          APIType: Schema.const("OpenAI"),
          BaseURL: Schema.string()
            .default("https://api.openai.com")
            .description("Embedding API 基础 URL"),
        }),
        Schema.object({
          APIType: Schema.const("Ollama"),
          BaseURL: Schema.string()
            .default("http://127.0.0.1:11434")
            .description("Embedding API 基础 URL"),
        }),
      ]),
    ]),
    Schema.object({
      Enabled: Schema.const(false),
    }),
  ]),
]);
