import { Context, Schema } from "koishi";

import { ModelService } from "./services/model-service";

export const name = "yesimbot-core";

export const inject = [];

export interface Config {
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
});

export function apply(ctx: Context, config: Config) {
  ctx.plugin(ModelService, config);

  ctx.on("ready", () => {
    ctx.logger("yesimbot-core").info("YesImBot core plugin initialized");
  });

  ctx.on("dispose", () => {
    ctx.logger("yesimbot-core").info("YesImBot core plugin disposed");
  });
}
