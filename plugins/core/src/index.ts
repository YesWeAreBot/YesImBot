import { Context, Schema, sleep } from "koishi";

import { AgentCore } from "./services/agent";
import { WillingnessSchema, type WillingnessConfig } from "./services/agent/willingness-config";
import { HorizonService, type HorizonServiceConfig } from "./services/horizon";
import { ModelService, type ModelServiceConfig } from "./services/model";
import { PluginService, type PluginServiceConfig } from "./services/plugin";
import { MemoryService, type MemoryConfig } from "./services/memory";
import { PromptService, type PromptServiceConfig } from "./services/prompt";

export const name = "yesimbot-core";

export const inject = ["database"];

export interface Config
  extends HorizonServiceConfig, PromptServiceConfig, PluginServiceConfig, ModelServiceConfig, MemoryConfig {
  concurrency?: number;
  model?: string;
  fallbackModel?: string;
  maxRounds?: number;
  streamMode?: boolean;
  globalTimeout?: number;
  maxToolResultLength?: number;
  willingness?: WillingnessConfig;
  errorReportChannel?: string;
}

export const Config: Schema<Config> = Schema.object({
  defaultModel: Schema.string(),
  fallbackChains: Schema.array(Schema.string()),
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
  archiveThresholdMs: Schema.number().default(86400000),
  templates: Schema.dict(Schema.string()),
  defaultTimeout: Schema.number().default(30000),
  model: Schema.dynamic("registry.chatModels").description("Agent chat model (provider:model)"),
  fallbackModel: Schema.dynamic("registry.chatModels").description(
    "Fallback model when primary unavailable",
  ),
  maxRounds: Schema.number().default(3),
  streamMode: Schema.boolean().default(false),
  globalTimeout: Schema.number().default(120000),
  maxToolResultLength: Schema.number().default(4000),
  willingness: WillingnessSchema,
  errorReportChannel: Schema.string().description(
    "Error report channel in platform:channelId format",
  ),
  botName: Schema.string().description("Bot display name (overrides platform name)"),
  entityCacheTtl: Schema.number().default(3600000).description("Entity cache TTL in ms"),
  maxActiveEntities: Schema.number().default(15).description("Max entities shown to LLM"),
  coreMemoryPath: Schema.path({ filters: ["directory"] }).description("Directory containing memory block files (.md/.txt)"),
  memoryCharLimit: Schema.number().default(4000).description("Maximum characters for memory block injection"),
});

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger("yesimbot-core");
  ctx.plugin(ModelService, config);
  ctx.plugin(HorizonService, {
    allowedChannels: config.allowedChannels ?? [],
    keywords: config.keywords,
    aggregationWindow: config.aggregationWindow,
    historyLimit: config.historyLimit,
    archiveThresholdMs: config.archiveThresholdMs,
    botName: config.botName,
    entityCacheTtl: config.entityCacheTtl,
    maxActiveEntities: config.maxActiveEntities,
  });
  ctx.plugin(PromptService, { templates: config.templates });
  ctx.plugin(MemoryService, { coreMemoryPath: config.coreMemoryPath, memoryCharLimit: config.memoryCharLimit });
  ctx.plugin(PluginService, { defaultTimeout: config.defaultTimeout });
  ctx.plugin(AgentCore, {
    model: config.model,
    fallbackModel: config.fallbackModel,
    maxRounds: config.maxRounds,
    streamMode: config.streamMode,
    globalTimeout: config.globalTimeout,
    maxToolResultLength: config.maxToolResultLength,
    willingness: config.willingness,
    errorReportChannel: config.errorReportChannel,
  });

  ctx.on("ready", () => {
    logger.info("YesImBot core plugin initialized");
    waitForServiceReady(ctx)
      .then(() => {
        logger.info("All services are ready");
      })
      .catch((err) => {
        logger.error("Error while waiting for services to be ready:", err);
      });
  });

  ctx.on("dispose", () => {
    logger.info("YesImBot core plugin disposed");
  });
}

async function waitForServiceReady(ctx: Context, timeout = 10000): Promise<void> {
  const services = [
    "yesimbot.agent",
    "yesimbot.horizon",
    "yesimbot.model",
    "yesimbot.plugin",
    "yesimbot.prompt",
    "yesimbot.memory",
  ];
  const resolvedServices = new Set<string>();
  const startTime = Date.now();

  while (resolvedServices.size < services.length) {
    for (const service of services) {
      if (!resolvedServices.has(service) && ctx.get(service)) {
        resolvedServices.add(service);
      }
    }
    if (Date.now() - startTime > timeout) {
      const unresolvedServices = services.filter((s) => !resolvedServices.has(s));
      throw new Error(
        `Timeout while waiting for services to be ready: ${unresolvedServices.join(", ")}`,
      );
    }
    await sleep(100);
  }
}
