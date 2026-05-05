import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ChatModelConfig, EmbeddingModelConfig, ModelProvider } from "@yesimbot/shared-model";
import { Context, Schema } from "koishi";

export const name = "yesimbot-provider-google";
export const reusable = true;
export const inject = ["yesimbot.model"];

export interface Config {
  id: string;
  apiKey: string;
  baseURL?: string;
  chatModels: ChatModelConfig[];
  embeddingModels: EmbeddingModelConfig[];
}

export const Config = Schema.object({
  id: Schema.string().default("google").description("提供商标识"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().description("API Base URL"),
  chatModels: Schema.array(
    Schema.object({
      id: Schema.string().required().description("模型 ID"),
      toolCall: Schema.boolean().default(true).description("支持工具调用"),
      reasoning: Schema.boolean().default(false).description("支持推理"),
    }),
  )
    .default([
      { id: "gemini-1.5-flash", toolCall: true, reasoning: false },
      { id: "gemini-1.5-pro", toolCall: true, reasoning: true },
    ])
    .description("可用聊天模型列表"),
  embeddingModels: Schema.array(
    Schema.object({
      id: Schema.string().required().description("模型 ID"),
    }),
  )
    .default([{ id: "text-embedding-004" }])
    .description("可用嵌入模型列表"),
});

export function apply(ctx: Context, config: Config) {
  const client = createGoogleGenerativeAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  const provider: ModelProvider = {
    id: config.id,
    capabilities: {
      chat: true,
      embedding: true,
    },
    chatModels: () => config.chatModels,
    embeddingModels: () => config.embeddingModels,
    chat: (modelId) => client.chat(modelId),
    embedding: (modelId) => client.embedding(modelId),
  };

  ctx["yesimbot.model"].register(provider);
  ctx.on("dispose", () => ctx["yesimbot.model"].unregister(config.id));
}
