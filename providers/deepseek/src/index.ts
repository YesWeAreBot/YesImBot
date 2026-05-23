import { createDeepSeek } from "@ai-sdk/deepseek";
import {
  createProviderPlugin,
  defaultSettingsMiddleware,
  wrapLanguageModel,
} from "@yesimbot/agent/ai";
import type { BaseProviderConfig } from "@yesimbot/agent/ai";
import { Schema } from "koishi";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

interface Config extends BaseProviderConfig {}

export const Config: Schema<Config> = Schema.object({
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

export default createProviderPlugin<Config, ReturnType<typeof createDeepSeek>>({
  name: "yesimbot-provider-deepseek",
  defaultId: "deepseek",
  capabilities: { chat: true, embedding: false },
  Config,
  createClient: ({ apiKey, baseURL }) => createDeepSeek({ apiKey, baseURL }),
  chat: (client, modelId, config) =>
    wrapLanguageModel({
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
    }),
});
