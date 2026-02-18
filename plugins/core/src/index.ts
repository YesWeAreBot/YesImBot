import { Context, Schema } from "koishi";

import { HorizonService, type HorizonConfig } from "./services/horizon";
import { ModelService } from "./services/model-service";

export const name = "yesimbot-core";

export const inject = ["database"];

export interface Config extends HorizonConfig {
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
      type: Schema.string().required(),
      id: Schema.string().required(),
    }),
  ).default([]),
  keywords: Schema.array(Schema.string()).default([]),
  aggregationWindow: Schema.number().default(1500),
  historyLimit: Schema.number().default(30),
});

export function apply(ctx: Context, config: Config) {
  ctx.plugin(ModelService, config);
  ctx.plugin(HorizonService, {
    allowedChannels: config.allowedChannels ?? [],
    keywords: config.keywords,
    aggregationWindow: config.aggregationWindow,
    historyLimit: config.historyLimit,
  });

  ctx.on("ready", () => {
    ctx.logger("yesimbot-core").info("YesImBot core plugin initialized");
  });

  ctx.on("dispose", () => {
    ctx.logger("yesimbot-core").info("YesImBot core plugin disposed");
  });
}
