import { Context, Schema, sleep } from "koishi";

import type { AgentCoreConfig } from "./services/agent";
import { AgentCore, AgentCoreConfigSchema } from "./services/agent";
import type { HorizonServiceConfig } from "./services/horizon";
import { HorizonService, HorizonServiceConfigSchema } from "./services/horizon";
import type { MemoryServiceConfig } from "./services/memory";
import { MemoryService, MemoryServiceConfigSchema } from "./services/memory";
import type { ModelServiceConfig } from "./services/model";
import { ModelService, ModelServiceConfigSchema } from "./services/model";
import type { PluginServiceConfig } from "./services/plugin";
import { PluginService, PluginServiceConfigSchema } from "./services/plugin";
import type { PromptServiceConfig } from "./services/prompt";
import { PromptService, PromptServiceConfigSchema } from "./services/prompt";

export const name = "yesimbot";
export const inject = ["database"];

export type Config = AgentCoreConfig &
  HorizonServiceConfig &
  MemoryServiceConfig &
  ModelServiceConfig &
  PluginServiceConfig &
  PromptServiceConfig;

export const Config: Schema<Config> = Schema.intersect([
  AgentCoreConfigSchema,
  HorizonServiceConfigSchema,
  MemoryServiceConfigSchema,
  ModelServiceConfigSchema,
  PluginServiceConfigSchema,
  PromptServiceConfigSchema,
]);

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger("yesimbot");
  ctx.plugin(ModelService, { concurrency: config.concurrency });
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
  ctx.plugin(MemoryService, {
    coreMemoryPath: config.coreMemoryPath,
    memoryCharLimit: config.memoryCharLimit,
  });
  ctx.plugin(PluginService, { defaultTimeout: config.defaultTimeout });
  ctx.plugin(AgentCore, {
    model: config.model,
    fallbackChain: config.fallbackChain,
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
