import { createOpenAI } from "@ai-sdk/openai";
import type { ModelEntry, ModelProvider } from "@yesimbot/shared-model";
import { Context, Schema } from "koishi";

export const name = "yesimbot-provider-openai";
export const reusable = true;
export const inject = ["yesimbot.model"];

export interface Config {
  id: string;
  apiKey: string;
  baseURL?: string;
  models: ModelEntry[];
}

export const Config = Schema.object({
  id: Schema.string().default("openai").description("提供商标识"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().description("API Base URL"),
  models: Schema.array(
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
    .description("可用模型列表"),
});

export function apply(ctx: Context, config: Config) {
  const client = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  const provider: ModelProvider = {
    id: config.id,
    chat: (modelId) => client.chat(modelId),
    embedding: (modelId) => client.embedding(modelId),
    models: () => config.models,
  };

  ctx["yesimbot.model"].register(provider);
  ctx.on("dispose", () => ctx["yesimbot.model"].unregister(config.id));
}
