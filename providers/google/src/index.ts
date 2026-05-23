import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createProviderPlugin } from "@yesimbot/agent/ai";
import type { BaseProviderConfig } from "@yesimbot/agent/ai";
import { Schema } from "koishi";

interface Config extends BaseProviderConfig {}

export const Config: Schema<Config> = Schema.object({
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

export default createProviderPlugin<Config, ReturnType<typeof createGoogleGenerativeAI>>({
  name: "yesimbot-provider-google",
  defaultId: "google",
  capabilities: { chat: true, embedding: true },
  Config,
  createClient: ({ apiKey, baseURL }) => createGoogleGenerativeAI({ apiKey, baseURL }),
  chat: (client, modelId) => client.chat(modelId),
  embedding: (client, modelId) => client.embedding(modelId),
});
