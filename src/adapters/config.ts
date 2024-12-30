import { Schema } from "koishi";

export interface LLM {
  APIType: "OpenAI" | "Cloudflare" | "Ollama" | "Custom URL";
  BaseURL: string;
  UID?: string;
  APIKey: string;
  AIModel: string;
  Ability?: Array<"原生工具调用" | "识图功能" | "结构化输出">;
  NUMA?: boolean;
  NumCtx?: number;
  NumBatch?: number;
  NumGPU?: number;
  MainGPU?: number;
  LowVRAM?: boolean;
  LogitsAll?: boolean;
  VocabOnly?: boolean;
  UseMMap?: boolean;
  UseMLock?: boolean;
  NumThread?: number;
}

export interface Config {
  APIList: LLM[];
}

export const API: Schema<LLM> = Schema.intersect([
  Schema.object({
    APIType: Schema.union(["OpenAI", "Cloudflare", "Ollama", "Custom URL"])
      .default("OpenAI")
      .description("API 类型"),
    BaseURL: Schema.string()
      .default("https://api.openai.com")
      .description("API 基础 URL, 设置为\"Custom URL\"需要填写完整的 URL"),
    APIKey: Schema.string().required().description("你的 API 令牌"),
    AIModel: Schema.string()
      .description("模型 ID"),
    Ability: Schema.array(Schema.union(["原生工具调用", "识图功能", "结构化输出"]))
      .role("checkbox")
      .experimental()
      .default([])
      .description("模型支持的功能。如果你不知道这是什么，请不要勾选"),
  }),
  Schema.union([
    Schema.object({
      APIType: Schema.const("Cloudflare"),
      UID: Schema.string().description("Cloudflare UID"),
    }),
    Schema.object({
      APIType: Schema.const("Ollama"),
      NUMA: Schema.boolean()
        .default(false)
        .description("是否使用 NUMA"),
      NumCtx: Schema.number()
        .min(1)
        .step(1)
        .default(8192)
        .description("上下文大小"),
      NumBatch: Schema.number()
        .min(0)
        .step(1)
        .default(0)
        .description("批处理线程数"),
      NumGPU: Schema.number()
        .min(0)
        .step(1)
        .default(1)
        .description("GPU 数量"),
      MainGPU: Schema.number()
        .min(0)
        .step(1)
        .default(0)
        .description("主要使用的 GPU 编号"),
      LowVRAM: Schema.boolean()
        .default(false)
        .description("是否使用低显存模式"),
      LogitsAll: Schema.boolean()
        .default(false)
        .description("是否输出所有 logits"),
      VocabOnly: Schema.boolean()
        .default(false)
        .description("是否只输出词表"),
      UseMMap: Schema.boolean()
        .default(true)
        .description("是否使用内存映射"),
      UseMLock: Schema.boolean()
        .default(false)
        .description("是否使用内存锁定"),
      NumThread: Schema.number()
        .min(0)
        .step(1)
        .default(0)
        .description("线程数"),
    }),
  ]),
]);

export const Config: Schema<Config> = Schema.object({
  APIList: Schema.array(API).description(
    "单个 LLM API 配置，可配置多个 API 进行负载均衡。"
  ),
}).description("LLM API 相关配置");
