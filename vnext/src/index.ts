import { join } from "node:path";

import { Context, Schema } from "koishi";

import { ListenerService } from "./services/listener";
import { ModelsService } from "./services/models";
import { SessionService } from "./services/session";

export interface Config {
  dataPath?: string;
  core: {
    primary: string;
    fallbacks: string[];
  };
  ingress?: {
    triggerKeywords?: string[];
    cooldownMs?: number;
    maxMessageLength?: number;
  };
  advanced?: {
    timeoutMs?: number;
    maxConcurrency?: number;
    requiresToolSupport?: boolean;
    toolTimeoutMs?: number;
    maxArgsBytes?: number;
    maxResultBytes?: number;
    maxBatchSize?: number;
  };
}

export default class VNextPlugin {
  static name = "athena-vnext";
  static usage = "athena-vnext";
  static Config: Schema<Config> = Schema.object({
    dataPath: Schema.path({ filters: ["directory"], allowCreate: true })
      .description("Data directory for Athena")
      .default(".athena"),
    core: Schema.object({
      primary: Schema.dynamic("registry.chatModels"),
      fallbacks: Schema.array(Schema.dynamic("registry.chatModels")).default([]),
    }),
    ingress: Schema.object({
      triggerKeywords: Schema.array(Schema.string()).default([]),
      cooldownMs: Schema.number().min(0).max(60000).step(100).default(3000),
      maxMessageLength: Schema.number().min(100).max(10000).step(100).default(4000),
    }).default({
      triggerKeywords: [],
      cooldownMs: 3000,
      maxMessageLength: 4000,
    }),
    advanced: Schema.object({
      timeoutMs: Schema.number().min(1000).max(600000).step(1000),
      maxConcurrency: Schema.number().min(1).max(50).step(1),
      requiresToolSupport: Schema.boolean(),
      toolTimeoutMs: Schema.number().min(1000).max(600000).step(1000),
      maxArgsBytes: Schema.number().min(1024).max(262144).step(256),
      maxResultBytes: Schema.number().min(1024).max(1048576).step(256),
      maxBatchSize: Schema.number().min(1).max(32).step(1),
    }),
  });

  constructor(ctx: Context, config: Config) {
    const athenaDir = config.dataPath?.trim() ? config.dataPath : join(ctx.baseDir, ".athena");

    ctx.plugin(ModelsService, {
      dataPath: athenaDir,
    });

    ctx.plugin(SessionService, {
      athenaDir,
      triggerKeywords: config.ingress?.triggerKeywords ?? [],
      cooldownMs: config.ingress?.cooldownMs ?? 3000,
      maxMessageLength: config.ingress?.maxMessageLength ?? 4000,
    });

    ctx.plugin(ListenerService, {});
  }
}
