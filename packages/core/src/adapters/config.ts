import { Schema } from "koishi";

export interface LLM {
  Enabled?: boolean;
  APIType: "OpenAI" | "Cloudflare" | "Ollama" | "Custom URL" | "Gemini";
  BaseURL: string;
  UID?: string;
  APIKey: string;
  AIModel: string;
  Ability?: Array<"原生工具调用" | "识图功能" | "结构化输出" | "流式输出" | "深度思考">;
  ReasoningStart?: string;
  ReasoningEnd?: string;
  ReasoningEffort?: "low" | "medium" | "high";
  Timeout?: number;

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
    Enabled: Schema.boolean().default(true).description("是否启用"),
    APIType: Schema.union(["OpenAI", "Cloudflare", "Ollama", "Custom URL", "Gemini"])
      .default("OpenAI")
      .description("API 类型"),
    // BaseURL: Schema.string()
    //   .default("https://api.openai.com")
    //   .description("API 基础 URL, 设置为\"Custom URL\"需要填写完整的 URL"),
    APIKey: Schema.string().required().description("你的 API 令牌"),
    AIModel: Schema.string()
      .description("模型 ID"),
    Ability: Schema.array(Schema.union(["原生工具调用", "识图功能", "结构化输出", "流式输出", "深度思考"]))
      .role("checkbox")
      .experimental()
      .default([])
      .description("模型支持的功能。<br/>请查阅[文档](https://github.com/HydroGest/AthenaDocsNG/blob/main/docs/user-guide/configuration/main-api.md)了解其作用。如果你不知道这是什么，请不要勾选。"),
    ReasoningStart: Schema.string().default("<think>").description("深度思考开始标识。<br/>对于DeepSeek的r系列模型，为`<think>`；<br/>对于OpenAI的o系列模型，为`> Reasoning`"),
    ReasoningEnd: Schema.string().default("</think>").description("深度思考结束标识。<br/>对于DeepSeek的r系列模型，为`</think>`；<br/>对于OpenAI的o系列模型，为`Reasoned for (?:a second|[^\\n]* seconds)`"),
    ReasoningEffort: Schema.union(["low", "medium", "high"]).default("medium").description("深度思考程度，即思维链的长度。<br/>DeepSeek的r系列模型暂不支持此功能，但将在近期上线；<br/>OpenAI的o系列模型支持此功能，可选项为`low`、`medium`、`high`。"),
    Timeout: Schema.number().default(60000).description("API请求超时时间（毫秒）"),
  }),
  Schema.union([
    Schema.object({
      APIType: Schema.const("OpenAI"),
      BaseURL: Schema.string().default("https://api.openai.com"),
    }),
    Schema.object({
      APIType: Schema.const("Cloudflare"),
      BaseURL: Schema.string().default("https://api.cloudflare.com/client/v4"),
      UID: Schema.string().required().description("Cloudflare UID"),
    }),
    Schema.object({
      APIType: Schema.const("Custom URL"),
      BaseURL: Schema.string().required().description("自定义 URL"),
    }),
    Schema.object({
      APIType: Schema.const("Ollama"),
      BaseURL: Schema.string().default("http://127.0.0.1:11434"),
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
    Schema.object({
      APIType: Schema.const("Gemini"),
      BaseURL: Schema.string().default("https://generativelanguage.googleapis.com"),
    }),
  ]),
]);

export const Config: Schema<Config> = Schema.object({
  APIList: Schema.array(API).description(
    "单个 LLM API 配置，可配置多个 API 进行负载均衡。"
  ),
}).description("LLM API 相关配置");
