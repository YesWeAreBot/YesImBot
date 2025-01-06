import { Schema } from "koishi";

export interface EnabledEmbeddingConfig {
  Enabled: true;
  APIType: "OpenAI" | "Custom" | "Ollama";
  BaseURL: string;
  APIKey: string;
  EmbeddingModel: string;
  EmbeddingDims: number;
  ChunkSize: number;

  RequestBody?: string;
  GetVecRegex?: string;
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
        APIType: Schema.union(["OpenAI", "Ollama", "Custom"])
          .default("OpenAI")
          .description("Embedding API 类型"),
        APIKey: Schema.string().description("API 令牌"),
        EmbeddingModel: Schema.string()
          .default("text-embedding-3-large")
          .description("Embedding 模型 ID"),
        EmbeddingDims: Schema.number()
          .default(1536)
          .experimental()
          .description("Embedding 向量维度"),
        ChunkSize: Schema.number()
          .default(300)
          .experimental()
          .description("文本分词长度"),
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
        Schema.object({
          APIType: Schema.const("Custom"),
          BaseURL: Schema.string().required(),
          RequestBody: Schema.string().description(
            "自定义请求体。<br/>其中：<br/>\
                `<text>`（包含尖括号）会被替换成用于计算嵌入向量的文本；<br/>\
                `<apikey>`（包含尖括号）会被替换成此页面设置的 API 密钥；<br/>\
                `<model>`（包含尖括号）会被替换成此页面设置的模型名称".trim()
          ),
          GetVecRegex: Schema.string().description("从自定义Embedding服务提取嵌入向量的正则表达式。注意转义"),
        }),
      ]),
    ]),
    Schema.object({
      Enabled: Schema.const(false),
    }),
  ]),
]);
