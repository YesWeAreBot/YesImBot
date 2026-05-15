import { createDeepSeek } from "@ai-sdk/deepseek";
import {
  ChatModelConfig,
  defaultSettingsMiddleware,
  ModelProvider,
  wrapLanguageModel,
} from "@yesimbot/agent/ai";
import { Context, Schema } from "koishi";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

export const name = "yesimbot-provider-deepseek";
export const reusable = true;
export const inject = ["yesimbot.model"];

export interface Config {
  id: string;
  apiKey: string;
  baseURL?: string;
  chatModels: ChatModelConfig[];
}

export const Config = Schema.object({
  id: Schema.string().default("deepseek").description("提供商标识"),
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
      { id: "deepseek-chat", toolCall: true, reasoning: false },
      { id: "deepseek-reasoner", toolCall: true, reasoning: true },
      { id: "deepseek-v4-flash", toolCall: true, reasoning: true },
      { id: "deepseek-v4-pro", toolCall: true, reasoning: true },
    ])
    .role("table")
    .description("可用聊天模型列表"),
}).i18n({
  "en-US": enUS._config,
  "zh-CN": zhCN._config,
});

export function apply(ctx: Context, config: Config) {
  const client = createDeepSeek({
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
    chat: (modelId) => {
      return wrapLanguageModel({
        model: client.chat(modelId),
        middleware: [
          defaultSettingsMiddleware({
            settings: {
              providerOptions: {
                [config.id]: {
                  reasoning_effort: "high",
                  thinking: {
                    type: "enabled",
                  },
                },
              },
            },
          }),
        ],
      });
    },
    embedding: () => {
      throw new Error(`Provider "${config.id}" does not support embedding`);
    },
  };

  ctx["yesimbot.model"].register(provider);
  ctx.on("dispose", () => ctx["yesimbot.model"].unregister(config.id));
}
