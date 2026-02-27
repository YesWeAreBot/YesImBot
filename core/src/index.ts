import { Context, Schema, sleep } from "koishi";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import type { AgentCoreConfig } from "./services/agent";
import { AgentCore } from "./services/agent";
import { WillingnessSchema } from "./services/agent/willingness";
import { ElementFormatterService } from "./services/element-formatter";
import type { HorizonServiceConfig } from "./services/horizon";
import { HorizonService } from "./services/horizon";
import type { ModelServiceConfig } from "./services/model";
import { ModelService } from "./services/model";
import type { PluginServiceConfig } from "./services/plugin";
import { PluginService } from "./services/plugin";
import type { PromptServiceConfig } from "./services/prompt";
import { PromptService } from "./services/prompt";
import type { RoleServiceConfig } from "./services/role";
import { RoleService } from "./services/role";
import type { SkillRegistryConfig } from "./services/skill";
import { SkillRegistry } from "./services/skill";
import type { TraitAnalyzerConfig } from "./services/trait";
import { TraitAnalyzer } from "./services/trait";

export const name = "yesimbot";
export const inject = ["database"];

export type Config = AgentCoreConfig &
  HorizonServiceConfig &
  ModelServiceConfig &
  PluginServiceConfig &
  PromptServiceConfig &
  RoleServiceConfig &
  SkillRegistryConfig &
  TraitAnalyzerConfig;

export const Config: Schema<Config> = Schema.intersect([
  // ── 基础 ──
  Schema.object({
    model: Schema.dynamic("registry.chatModels"),
    fallbackChain: Schema.array(Schema.dynamic("registry.chatModels")).default([]),
    errorReportChannel: Schema.string(),
    allowedChannels: Schema.array(
      Schema.object({
        platform: Schema.string().required(),
        type: Schema.union(["private", "guild"]).required(),
        id: Schema.string().required(),
      }),
    )
      .default([])
      .role("table"),
    botName: Schema.string(),
    keywords: Schema.array(Schema.string()).default([]),
  }).description({ "zh-CN": "基础", "en-US": "Basic" } as never),

  // ── 模型 ──
  Schema.object({
    maxRounds: Schema.number().default(3),
    streamMode: Schema.boolean().default(false),
    globalTimeout: Schema.number().default(120000),
    maxToolResultLength: Schema.number().default(4000),
    concurrency: Schema.number().default(5),
  }).description({ "zh-CN": "模型", "en-US": "Model" } as never),

  // ── 意愿值 ──
  Schema.object({
    willingness: WillingnessSchema,
    aggregationWindow: Schema.number().default(1500),
  }).description({ "zh-CN": "意愿值", "en-US": "Willingness" } as never),

  // ── 提示词 ──
  Schema.object({
    templates: Schema.dict(Schema.string()),
    timeout: Schema.number().default(5000),
    resourcesDir: Schema.string(),
    rolePath: Schema.path({ filters: ["directory"], allowCreate: true }).default(
      "data/yesimbot/roles",
    ),
    skillPaths: Schema.array(Schema.path({ filters: ["directory"], allowCreate: true })).default(
      [],
    ),
    confidenceThreshold: Schema.number().default(0.3),
    stickyDefaultTimeout: Schema.number().default(3),
  }).description({ "zh-CN": "提示词", "en-US": "Prompt" } as never),

  // ── 高级 ──
  Schema.object({
    enableThoughts: Schema.boolean().default(true),
    charBudget: Schema.number().default(30000),
    keepLastRounds: Schema.number().default(2),
    softTrimHead: Schema.number().default(800),
    softTrimTail: Schema.number().default(800),
    initialContextCharBudget: Schema.number().default(20000),
    historyLimit: Schema.number().default(30),
    archiveThresholdMs: Schema.number().default(86400000),
    entityCacheTtl: Schema.number().default(3600000),
    maxActiveEntities: Schema.number().default(15),
    defaultTimeout: Schema.number().default(30000),
    debugLevel: Schema.union([
      Schema.const(0),
      Schema.const(1),
      Schema.const(2),
      Schema.const(3),
    ]).default(2),
  }).description({ "zh-CN": "高级", "en-US": "Advanced" } as never),
]).i18n({
  "zh-CN": zhCN._config,
  "en-US": enUS._config,
});

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger("yesimbot");
  ctx.plugin(ElementFormatterService);
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
  ctx.plugin(RoleService, { rolePath: config.rolePath });
  ctx.plugin(PluginService, { defaultTimeout: config.defaultTimeout });
  ctx.plugin(TraitAnalyzer, {});
  ctx.plugin(SkillRegistry, {
    skillPaths: config.skillPaths,
    confidenceThreshold: config.confidenceThreshold,
    stickyDefaultTimeout: config.stickyDefaultTimeout,
  });
  ctx.plugin(AgentCore, {
    model: config.model,
    fallbackChain: config.fallbackChain,
    maxRounds: config.maxRounds,
    streamMode: config.streamMode,
    globalTimeout: config.globalTimeout,
    maxToolResultLength: config.maxToolResultLength,
    willingness: config.willingness,
    errorReportChannel: config.errorReportChannel,
    debugLevel: config.debugLevel,
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
    "yesimbot.element-formatter",
    "yesimbot.horizon",
    "yesimbot.model",
    "yesimbot.plugin",
    "yesimbot.prompt",
    "yesimbot.role",
    "yesimbot.skill",
    "yesimbot.trait",
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
