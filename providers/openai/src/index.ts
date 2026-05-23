import { createOpenAI } from "@ai-sdk/openai";
import { createProviderPlugin } from "@yesimbot/agent/ai";
import type { BaseProviderConfig } from "@yesimbot/agent/ai";
import { Schema } from "koishi";

interface Config extends BaseProviderConfig {
  format: "chat" | "responses";
}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("openai").description("提供商标识"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().description("API Base URL"),
  format: Schema.union([Schema.const("chat"), Schema.const("responses")])
    .default("chat")
    .description("API 格式"),
  chatModels: Schema.array(
    Schema.object({
      id: Schema.string().required().description("模型 ID"),
      toolCall: Schema.boolean().default(true).description("支持工具调用"),
      reasoning: Schema.boolean().default(false).description("支持推理"),
    }),
  )
    .role("table")
    .default([
      { id: "gpt-4o", toolCall: true, reasoning: false },
      { id: "o3-mini", toolCall: true, reasoning: true },
    ])
    .description("可用聊天模型列表"),
  embeddingModels: Schema.array(
    Schema.object({
      id: Schema.string().required().description("模型 ID"),
    }),
  )
    .role("table")
    .default([{ id: "text-embedding-3-large" }])
    .description("可用嵌入模型列表"),
});

export default createProviderPlugin<Config, ReturnType<typeof createOpenAI>>({
  name: "yesimbot-provider-openai",
  defaultId: "openai",
  capabilities: { chat: true, embedding: true },
  Config,
  createClient: ({ apiKey, baseURL }) => createOpenAI({ apiKey, baseURL }),
  chat: (client, modelId, config) =>
    config.format === "responses" ? client.responses(modelId) : client.chat(modelId),
  embedding: (client, modelId) => client.embedding(modelId),
});
