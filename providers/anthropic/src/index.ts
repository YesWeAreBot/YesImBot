import { createAnthropic } from "@ai-sdk/anthropic";
import type { ChatModelConfig, ModelProvider } from "@yesimbot/agent/ai";
import { Context, Schema } from "koishi";

export const name = "yesimbot-provider-anthropic";
export const reusable = true;
export const inject = ["yesimbot.model"];

export interface Config {
  id: string;
  apiKey: string;
  baseURL?: string;
  chatModels: ChatModelConfig[];
}

export const Config = Schema.object({
  id: Schema.string().default("anthropic").description("提供商标识"),
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
      { id: "claude-opus-4-6", toolCall: true, reasoning: true },
      { id: "claude-sonnet-4-6", toolCall: true, reasoning: true },
      { id: "claude-haiku-4-5-20251001", toolCall: true, reasoning: true },
    ])
    .role("table")
    .description("可用聊天模型列表"),
});

export function apply(ctx: Context, config: Config) {
  const client = createAnthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  const provider: ModelProvider = {
    id: config.id,
    capabilities: {
      chat: true,
      embedding: false,
    },
    chatModels: () => config.chatModels,
    embeddingModels: () => [],
    chat: (modelId) => client.chat(modelId),
    embedding: () => {
      throw new Error(`Provider "${config.id}" does not support embedding`);
    },
  };

  ctx["yesimbot.model"].register(provider);
  ctx.on("dispose", () => ctx["yesimbot.model"].unregister(config.id));
}
