import { createAnthropic } from "@ai-sdk/anthropic";
import { Context, Schema } from "koishi";
import { defaultSettingsMiddleware, wrapLanguageModel, ToolSet, type BaseProviderConfig } from "koishi-plugin-yesimbot";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

export const name = "yesimbot-provider-anthropic";

export const usage = "Anthropic 提供商插件";

export const inject = ["yesimbot"];

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("anthropic").description("提供商标识"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().description("API Base URL"),
  webSearch: Schema.boolean().default(false).description("启用原生 Web 搜索"),
  chatModels: Schema.array(
    Schema.object({
      id: Schema.string().required().description("模型 ID"),
      toolCall: Schema.boolean().default(true).description("工具调用"),
      reasoning: Schema.boolean().default(false).description("推理"),
    }),
  )
    .role("table")
    .default([
      { id: "claude-opus-4-6", toolCall: true, reasoning: true },
      { id: "claude-sonnet-4-6", toolCall: true, reasoning: true },
      { id: "claude-haiku-4-5-20251001", toolCall: true, reasoning: true },
    ])
    .description("可用聊天模型列表"),
}).i18n({
  "zh-CN": zhCN._config,
  "en-US": enUS._config,
});

export interface Config extends BaseProviderConfig {
  webSearch: boolean;
}

export function apply(ctx: Context, config: Config) {
  ctx.on("ready", () => {
    const client = createAnthropic({ apiKey: config.apiKey, baseURL: config.baseURL });
    const dispose = ctx.yesimbot.model.register({
      id: config.id,
      capabilities: { chat: true, embedding: false },
      chatModels: () => config.chatModels,
      embeddingModels: () => [],
      // One top-level breakpoint caches tools, system and history as a single prefix and slides forward as the
      // conversation grows, so a growing channel keeps reusing the same cache instead of rewriting it every turn.
      chat: (modelId: string) =>
        wrapLanguageModel({
          model: client.chat(modelId),
          middleware: [defaultSettingsMiddleware({ settings: { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } } })],
        }),
      embedding: () => {
        throw new Error(`Provider "${config.id}" does not support embedding`);
      },
      // The provider-defined tool is not part of the `ToolSet` union; the SDK reads it through the same map.
      tools: (): ToolSet => (config.webSearch ? ({ web_search: client.tools.webSearch_20250305() } as never) : {}),
    });
    ctx.on("dispose", dispose);
  });
}
