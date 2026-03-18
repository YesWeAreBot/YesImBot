import { Context, Schema } from "koishi";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import type { AgentCoreConfig } from "./services/agent";
import { AgentCore } from "./services/agent";
import { WillingnessSchema } from "./services/agent/willingness";
import type { ArousalConfig } from "./services/arousal";
import { ArousalService } from "./services/arousal";
import { FormatterService } from "./services/formatter";
import { HookService } from "./services/hook/service";
import type { HookServiceConfig } from "./services/hook/types";
import type { HorizonServiceConfig } from "./services/horizon";
import { HorizonService } from "./services/horizon";
import { ImageCacheService } from "./services/image-cache/service";
import type { MemoryAgentServiceConfig } from "./services/memory-agent";
import { MemoryAgentService } from "./services/memory-agent";
import type { ModelServiceConfig } from "./services/model";
import { ModelService } from "./services/model";
import type { PluginServiceConfig } from "./services/plugin";
import { PluginService } from "./services/plugin";
import type { PromptServiceConfig } from "./services/prompt";
import { PromptService } from "./services/prompt";
import type { PersonaServiceConfig } from "./services/role";
import { PersonaService } from "./services/role";
import type { SkillRegistryConfig } from "./services/skill";
import { AgentSessionStore, SkillRegistry } from "./services/skill";
import type { TraitAnalyzerConfig } from "./services/trait";

export const name = "yesimbot";
export const inject = ["database"];

declare module "koishi" {
  interface Events {
    "athena:willingness.changed": (
      channelKey: { platform: string; channelId: string },
      oldValue: number,
      newValue: number,
    ) => void;

    "athena:timeline.compressed": (
      channelKey: { platform: string; channelId: string },
      beforeCount: number,
      afterCount: number,
    ) => void;

    "athena:cache.evicted": (
      cacheType: "image" | "entity",
      id: string,
      reason: "ttl" | "lru" | "manual",
    ) => void;

    "athena:hook.registered": (
      hookId: string,
      hookType: string,
      hookPhase: string,
      source?: string,
    ) => void;

    "athena:hook.started": (
      hookId: string,
      hookType: string,
      hookPhase: string,
      traceId: string,
    ) => void;

    "athena:hook.completed": (
      hookId: string,
      hookType: string,
      hookPhase: string,
      traceId: string,
      durationMs: number,
      outcome: string,
    ) => void;

    "athena:hook.failed": (
      hookId: string,
      hookType: string,
      hookPhase: string,
      traceId: string,
      durationMs: number,
      reason: string,
      error?: Error,
    ) => void;
  }
}

export type Config = AgentCoreConfig &
  HorizonServiceConfig &
  ModelServiceConfig &
  PluginServiceConfig &
  PromptServiceConfig &
  PersonaServiceConfig &
  SkillRegistryConfig &
  TraitAnalyzerConfig &
  MemoryAgentServiceConfig &
  HookServiceConfig & { arousal: ArousalConfig };

export const Config: Schema<Config> = Schema.intersect([
  // ── 基础 ──
  Schema.object({
    model: Schema.dynamic("registry.chatModels"),
    fallbackChain: Schema.array(Schema.dynamic("registry.chatModels")).collapse(true).default([]),
    summaryModel: Schema.dynamic("registry.chatModels"),
    errorReportChannel: Schema.string(),
    allowedChannels: Schema.array(
      Schema.object({
        platform: Schema.string().required(),
        type: Schema.union(["private", "guild"]).default("private"),
        id: Schema.string().required(),
      }),
    )
      .default([])
      .role("table"),
    keywords: Schema.array(Schema.string()).default([]),
  }),

  // ── 模型 ──
  Schema.object({
    maxRounds: Schema.number().min(1).max(20).step(1).default(3),
    streamMode: Schema.boolean().default(false),
    globalTimeout: Schema.number().min(1000).max(600000).step(1000).default(120000),
    maxToolResultLength: Schema.number().min(1000).max(20000).step(1000).default(4000),
    concurrency: Schema.number().min(1).max(50).step(1).default(5),
  }),

  // ── 意愿值 ──
  Schema.object({
    willingness: WillingnessSchema,
    aggregationWindow: Schema.number().min(1000).max(30000).step(1000).default(2000),
  }),

  // ── 提示词 ──
  Schema.object({
    templates: Schema.dict(Schema.string()),
    timeout: Schema.number().min(1000).max(120000).step(1000).default(5000),
    rolePath: Schema.path({ filters: ["directory"], allowCreate: true }).default(
      "data/yesimbot/roles",
    ),
    skillPaths: Schema.array(Schema.path({ filters: ["directory"], allowCreate: true }))
      .default(["node_modules/koishi-plugin-yesimbot/resources/skills"])
      .role("table"),
    confidenceThreshold: Schema.number().min(0).max(1).step(0.01).default(0.3),
    stickyDefaultTimeout: Schema.number().min(1).max(30).step(1).default(3),
  }),

  // ── 图片 ──
  Schema.object({
    imageMode: Schema.union([Schema.const("native"), Schema.const("off")]).default("native"),
    maxImagesInContext: Schema.number().min(0).max(20).step(1).default(3),
    imageLifecycleCount: Schema.number().min(1).max(30).step(1).default(3),
  }),

  // ── 记忆代理 ──
  Schema.object({
    memoryAgent: Schema.object({
      coreMemoryBudget: Schema.number().min(1000).max(20000).step(1).default(2000),
      summaryModel: Schema.dynamic("registry.chatModels"),
      maxAgentSteps: Schema.number().min(1).max(100).step(1).default(15),
    }),
    compressionThreshold: Schema.number()
      .min(1)
      .max(1000)
      .step(1)
      .default(100)
      .description("Event count to trigger timeline compression"),
    inactivityTriggerMs: Schema.number()
      .min(1000)
      .max(172800000)
      .step(1000)
      .default(3600000)
      .description("Inactivity period (ms) to trigger timeline compression (default: 1 hour)"),
    retainRecentEntries: Schema.number()
      .min(1)
      .max(100)
      .step(1)
      .default(10)
      .description("Keep N most recent timeline entries uncompressed"),
  }),

  // ── 主动唤醒 ──
  Schema.object({
    arousal: Schema.object({
      enabled: Schema.boolean().default(false),
      heartbeatIntervalMs: Schema.number().min(1000).max(172800000).step(1000).default(1800000),
      excludeChannels: Schema.array(Schema.string()).default([]),
      dailyMessageLimit: Schema.number().min(1).max(100).step(1).default(3),
      evaluationModel: Schema.dynamic("registry.chatModels"),
    }),
  }),

  // ── 上下文管理 ──
  Schema.object({
    charBudget: Schema.number().min(1000).max(200000).step(1000).default(30000),
    keepLastRounds: Schema.number().min(0).max(20).step(1).default(2),
    softTrimHead: Schema.number().min(100).max(100000).step(1).default(800),
    softTrimTail: Schema.number().min(100).max(100000).step(1).default(800),
    initialContextCharBudget: Schema.number().min(1000).max(200000).step(1000).default(20000),
    historyLimit: Schema.number().min(1).max(500).step(1).default(30),
  }),

  // ── 高级 ──
  Schema.object({
    enableThoughts: Schema.boolean().default(true),
    archiveThresholdMs: Schema.number().min(1000).max(2592000000).step(1000).default(86400000),
    entityCacheTtl: Schema.number().min(1000).max(604800000).step(1000).default(3600000),
    maxActiveEntities: Schema.number().min(1).max(200).step(1).default(15),
    defaultTimeout: Schema.number().min(1000).max(600000).step(1000).default(30000),
    debugLevel: Schema.union([
      Schema.const(0),
      Schema.const(1),
      Schema.const(2),
      Schema.const(3),
    ]).default(2),
    hookTimeouts: Schema.object({
      tool: Schema.number()
        .min(1000)
        .max(120000)
        .step(1000)
        .default(3000)
        .description("Tool hook timeout in ms"),
      agent: Schema.number()
        .min(1000)
        .max(120000)
        .step(1000)
        .default(5000)
        .description("Agent hook timeout in ms"),
    }),
  }),
]).i18n({
  "zh-CN": zhCN._config,
  "en-US": enUS._config,
});

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger("yesimbot");
  const command = ctx.command("yesimbot", "Yes! I'm Bot! 指令集", { authority: 3 });
  ctx.plugin(ImageCacheService, { debugLevel: config.debugLevel });
  ctx.plugin(FormatterService, { debugLevel: config.debugLevel });
  ctx.plugin(ModelService, { concurrency: config.concurrency, debugLevel: config.debugLevel });
  ctx.plugin(HorizonService, {
    allowedChannels: config.allowedChannels ?? [],
    keywords: config.keywords,
    aggregationWindow: config.aggregationWindow,
    historyLimit: config.historyLimit,
    archiveThresholdMs: config.archiveThresholdMs,
    entityCacheTtl: config.entityCacheTtl,
    maxActiveEntities: config.maxActiveEntities,
    summaryModel: config.summaryModel,
    compressionThreshold: config.compressionThreshold,
    inactivityTriggerMs: config.inactivityTriggerMs,
    retainRecentEntries: config.retainRecentEntries,
    debugLevel: config.debugLevel,
  });
  ctx.plugin(PromptService, { templates: config.templates, debugLevel: config.debugLevel });
  ctx.plugin(PersonaService, { rolePath: config.rolePath, debugLevel: config.debugLevel });
  ctx.plugin(HookService, {
    hookTimeouts: config.hookTimeouts,
    logLevel: config.debugLevel,
    debugLevel: config.debugLevel,
  });
  ctx.plugin(PluginService, {
    defaultTimeout: config.defaultTimeout,
    debugLevel: config.debugLevel,
  });
  // Session-backed cross-round skill state must exist before runtime consumers.
  ctx.plugin(AgentSessionStore);
  // Internal legacy compatibility — not required by agent main loop
  // ctx.plugin(TraitAnalyzer, { debugLevel: config.debugLevel });
  ctx.plugin(SkillRegistry, {
    skillPaths: config.skillPaths,
    confidenceThreshold: config.confidenceThreshold,
    stickyDefaultTimeout: config.stickyDefaultTimeout,
    debugLevel: config.debugLevel,
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
    imageMode: config.imageMode,
    maxImagesInContext: config.maxImagesInContext,
    imageLifecycleCount: config.imageLifecycleCount,
  });
  ctx.plugin(MemoryAgentService, {
    memoryAgent: config.memoryAgent,
    debugLevel: config.debugLevel,
  });
  ctx.plugin(ArousalService, { ...config.arousal, debugLevel: config.debugLevel });

  ctx.on("ready", () => {
    logger.info("YesImBot core plugin initialized");
  });

  ctx.on("dispose", () => {
    logger.info("YesImBot core plugin disposed");
  });

  ctx.on("yesimbot/set-model", (provider, modelId) => {
    logger.info(`Model updated: ${provider} ${modelId}`);
    config.model = `${provider}:${modelId}`;
    ctx.scope.update(config, true);
  });

  command.subcommand(".model.current", "显示当前会话使用的模型").action(() => {
    const currentModel = config.model;
    if (!currentModel) return "当前会话未设置模型";
    return `当前会话使用的模型: ${currentModel}`;
  });
}
