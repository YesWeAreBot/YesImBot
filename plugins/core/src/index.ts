import { Context, Schema } from "koishi";

import { HorizonService, type HorizonServiceConfig } from "./services/horizon";
import { ModelService, type ModelServiceConfig } from "./services/model";
import { PluginService, type PluginServiceConfig } from "./services/plugin";
import { PromptService, type PromptServiceConfig } from "./services/prompt";

export const name = "yesimbot-core";

export const inject = ["database"];

export interface Config
  extends HorizonServiceConfig, PromptServiceConfig, PluginServiceConfig, ModelServiceConfig {
  defaultProvider?: string;
  defaultModel?: string;
  fallbackChains?: Record<string, Array<{ provider: string; model: string }>>;
  concurrency?: number;
}

export const Config: Schema<Config> = Schema.object({
  defaultProvider: Schema.string(),
  defaultModel: Schema.string(),
  fallbackChains: Schema.dict(
    Schema.array(
      Schema.object({
        provider: Schema.string().required(),
        model: Schema.string().required(),
      }),
    ),
  ),
  concurrency: Schema.number().default(5),
  allowedChannels: Schema.array(
    Schema.object({
      platform: Schema.string().required(),
      type: Schema.union(["private", "guild"]).required(),
      id: Schema.string().required(),
    }),
  )
    .default([])
    .role("table"),
  keywords: Schema.array(Schema.string()).default([]),
  aggregationWindow: Schema.number().default(1500),
  historyLimit: Schema.number().default(30),
  templates: Schema.dict(Schema.string()),
  defaultTimeout: Schema.number().default(30000),
});

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger("yesimbot-core");
  ctx.plugin(ModelService, config);
  ctx.plugin(HorizonService, {
    allowedChannels: config.allowedChannels ?? [],
    keywords: config.keywords,
    aggregationWindow: config.aggregationWindow,
    historyLimit: config.historyLimit,
  });
  ctx.plugin(PromptService, { templates: config.templates });
  ctx.plugin(PluginService, { defaultTimeout: config.defaultTimeout });

  ctx.on("ready", () => {
    logger.info("YesImBot core plugin initialized");
  });

  ctx.on("dispose", () => {
    logger.info("YesImBot core plugin disposed");
  });
}
