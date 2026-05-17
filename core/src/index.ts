import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { Context, Schema } from "koishi";

import { AdapterServiceImpl } from "./adapter/index.js";
import { ExtensionConfig, ExtensionService } from "./extension.js";
import { RuntimeConfig, RuntimeService } from "./runtime.js";
import { ModelService, ModelServiceConfig } from "./services/model/index.js";
import { SessionConfig, SessionService } from "./services/session/index.js";

export type Config =
  | ModelServiceConfig
  | SessionConfig
  | RuntimeConfig
  | ExtensionConfig
  | {
      basePath: string;
      chatModel: string;
      logLevel?: number;
    };

export const name = "yesimbot";
export const inject = [];

export const Config = Schema.object({
  chatModel: Schema.dynamic("registry.chatModels"),
  allowedChannels: Schema.array(
    Schema.object({
      platform: Schema.string().required(),
      channelId: Schema.string().required(),
      type: Schema.union(["private", "group"] as const).required(),
    }),
  )
    .role("table")
    .default([]),
  basePath: Schema.path({ filters: ["directory"], allowCreate: true }).default("data/yesimbot"),
  modelsConfigPath: Schema.path({ filters: ["file"], allowCreate: true }),
  logLevel: Schema.union([0, 1, 2, 3]).default(2),
});

export async function apply(ctx: Context, config: Config) {
  if (config.basePath) {
    config.basePath = resolve(ctx.baseDir, config.basePath);
    if (!existsSync(config.basePath)) {
      mkdirSync(config.basePath, { recursive: true });
    }
  }
  ctx.plugin(ModelService, config);
  ctx.plugin(ExtensionService, config as ExtensionConfig);
  ctx.plugin(SessionService, config as SessionConfig);
  ctx.plugin(AdapterServiceImpl);
  ctx.plugin(RuntimeService, config as RuntimeConfig);
}

export type { AthenaExtensionDefinition, ChannelContext, ExtensionService } from "./extension";
export type { RuntimeService } from "./runtime";
export type { ModelService } from "./services/model";
export type { SessionService } from "./services/session";
export type { AthenaEvent, PlatformAdapter } from "./adapter/index.js";
export { encodeChannelId } from "./services/session/encoding.js";
