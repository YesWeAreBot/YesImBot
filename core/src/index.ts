import { Context, Schema } from "koishi";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";
import type { AgentCoreConfig } from "./services/agent";
import { AgentCore } from "./services/agent";
import { WillingnessSchema } from "./services/agent/willingness";
import type { ArousalConfig } from "./services/arousal";
import { ArousalService } from "./services/arousal";
import { FormatterService } from "./services/formatter";
import type { HorizonServiceConfig } from "./services/horizon";
import { HorizonService } from "./services/horizon";
import { HookService } from "./services/hook/service";
import { ImageCacheService } from "./services/image-cache/service";
import type { MemoryAgentServiceConfig } from "./services/memory-agent";
import { MemoryAgentService } from "./services/memory-agent";
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
  }
}

export type Config = AgentCoreConfig &
  HorizonServiceConfig &
  ModelServiceConfig &
  PluginServiceConfig &
  PromptServiceConfig &
  RoleServiceConfig &
  SkillRegistryConfig &
  TraitAnalyzerConfig &
  MemoryAgentServiceConfig &
  { arousal: ArousalConfig };

export const Config: Schema<Config> = Schema.intersect([
  // ── 基础 ──
  Schema.object({
    model: Schema.dynamic("registry.chatModels"),
    summaryModel: Schema.dynamic("registry.chatModels"),
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
    keywords: Schema.array(Schema.string()).default([]),
    compressionThreshold: Schema.number().default(100).description("Event count to trigger timeline compression"),
    inactivityTriggerMs: Schema.number().default(3600000).description("Inactivity period (ms) to trigger timeline compression (default: 1 hour)"),
    retainRecentEntries: Schema.number().default(10).description("Keep N most recent timeline entries uncompressed"),
  }),

  // ── 模型 ──
  Schema.object({
    maxRounds: Schema.number().default(3),
    streamMode: Schema.boolean().default(false),
    globalTimeout: Schema.number().default(120000),
    maxToolResultLength: Schema.number().default(4000),
    concurrency: Schema.number().default(5),
  }),

  // ── 意愿值 ──
  Schema.object({
    willingness: WillingnessSchema,
    aggregationWindow: Schema.number().default(1500),
  }),

  // ── 提示词 ──
  Schema.object({
    templates: Schema.dict(Schema.string()),
    timeout: Schema.number().default(5000),
    rolePath: Schema.path({ filters: ["directory"], allowCreate: true }).default(
      "data/yesimbot/roles",
    ),
    skillPaths: Schema.array(Schema.path({ filters: ["directory"], allowCreate: true }))
      .default(["node_modules/koishi-plugin-yesimbot/resources/skills"])
      .role("table"),
    confidenceThreshold: Schema.number().default(0.3),
    stickyDefaultTimeout: Schema.number().default(3),
  }),

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
    imageMode: Schema.union([Schema.const("native"), Schema.const("off")]).default("native"),
    maxImagesInContext: Schema.number().default(3),
    imageLifecycleCount: Schema.number().default(3),
  }),

  // ── 记忆代理 ──
  Schema.object({
    memoryAgent: Schema.object({
      coreMemoryBudget: Schema.number().default(2000),
      summaryModel: Schema.dynamic("registry.chatModels"),
      maxAgentSteps: Schema.number().default(15),
    }),
  }),

  // ── 主动唤醒 ──
  Schema.object({
    arousal: Schema.object({
      enabled: Schema.boolean().default(false),
      heartbeatIntervalMs: Schema.number().default(1800000),
      excludeChannels: Schema.array(Schema.string()).default([]),
      dailyMessageLimit: Schema.number().default(3),
      evaluationModel: Schema.dynamic("registry.chatModels"),
    }),
  }),
]).i18n({
  "zh-CN": zhCN._config,
  "en-US": enUS._config,
});

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger("yesimbot");
  const command = ctx.command("yesimbot", "Yes! I'm Bot! 指令集", { authority: 3 });
  ctx.plugin(ImageCacheService);
  ctx.plugin(FormatterService);
  ctx.plugin(ModelService, { concurrency: config.concurrency });
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
  });
  ctx.plugin(PromptService, { templates: config.templates });
  ctx.plugin(RoleService, { rolePath: config.rolePath });
  ctx.plugin(HookService);
  ctx.plugin(PluginService, {
    defaultTimeout: config.defaultTimeout,
  });
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
    imageMode: config.imageMode,
    maxImagesInContext: config.maxImagesInContext,
    imageLifecycleCount: config.imageLifecycleCount,
  });
  ctx.plugin(MemoryAgentService, {
    memoryAgent: config.memoryAgent,
  });
  ctx.plugin(ArousalService, config.arousal);

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
