import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { Context, Schema } from "koishi";

import { AdapterService } from "./adapter/index.js";
import { AdapterConfig } from "./adapter/service.js";
import { ChatHistoryPlugin } from "./extension/built-in/chat-history/index.js";
import { ExtensionConfig, ExtensionService } from "./extension/service.js";
import { RuntimeConfig, RuntimeService } from "./runtime/service.js";
import { ModelService, ModelServiceConfig } from "./services/model/index.js";
import { SessionConfig, SessionService } from "./services/session/index.js";

export type Config = ModelServiceConfig &
  SessionConfig &
  RuntimeConfig &
  ExtensionConfig &
  AdapterConfig & {
    basePath: string;
    chatModel: string;
    logLevel?: number;
    enableChatTools?: boolean;
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
  logLevel: Schema.union([0, 1, 2, 3]).default(2),
  runtimeSettings: Schema.object({
    contextWindow: Schema.number()
      .min(1000)
      .max(1000000)
      .default(128000)
      .description("上下文窗口大小（token 数）"),
    compaction: Schema.object({
      enabled: Schema.boolean().default(true).description("启用上下文压缩"),
      reserveTokens: Schema.number()
        .min(1000)
        .max(100000)
        .default(16384)
        .description("压缩保留的 token 数"),
      keepRecentTokens: Schema.number()
        .min(1000)
        .max(100000)
        .default(20000)
        .description("保留最近消息的 token 数"),
    }).description("上下文压缩配置"),
    retry: Schema.object({
      enabled: Schema.boolean().default(true).description("启用自动重试"),
      maxRetries: Schema.number().min(0).max(10).default(3).description("最大重试次数"),
      baseDelayMs: Schema.number()
        .min(100)
        .max(30000)
        .default(2000)
        .description("基础重试延迟（毫秒）"),
      maxDelayMs: Schema.number()
        .min(1000)
        .max(300000)
        .default(60000)
        .description("最大重试延迟（毫秒）"),
    }).description("重试配置"),
    steeringMode: Schema.union(["all", "one-at-a-time"] as const)
      .default("all")
      .description("引导模式"),
    followUpMode: Schema.union(["all", "one-at-a-time"] as const)
      .default("all")
      .description("跟进模式"),
    delivery: Schema.object({
      enabled: Schema.boolean().default(true).description("启用消息分段发送"),
      segmentation: Schema.object({
        shortSegmentChars: Schema.number()
          .min(1)
          .max(100)
          .default(6)
          .description("短段落字符数阈值"),
        shortTextChars: Schema.number().min(1).max(500).default(25).description("短文本字符数阈值"),
      }).description("分段配置"),
      timing: Schema.object({
        initialDelayMinMs: Schema.number()
          .min(0)
          .max(10000)
          .default(300)
          .description("初始延迟最小值（毫秒）"),
        initialDelayMaxMs: Schema.number()
          .min(0)
          .max(10000)
          .default(1200)
          .description("初始延迟最大值（毫秒）"),
        followupDelayMinMs: Schema.number()
          .min(0)
          .max(30000)
          .default(1200)
          .description("后续延迟最小值（毫秒）"),
        followupDelayMaxMs: Schema.number()
          .min(0)
          .max(30000)
          .default(4500)
          .description("后续延迟最大值（毫秒）"),
        maxDelayMs: Schema.number().min(0).max(60000).default(6500).description("最大延迟（毫秒）"),
        minimumBufferMinMs: Schema.number()
          .min(0)
          .max(5000)
          .default(150)
          .description("最小缓冲区最小值（毫秒）"),
        minimumBufferMaxMs: Schema.number()
          .min(0)
          .max(5000)
          .default(400)
          .description("最小缓冲区最大值（毫秒）"),
      }).description("延迟配置"),
    }).description("消息分段发送配置"),
  }).description("运行时设置"),
  enableChatTools: Schema.boolean().default(true).description("启用聊天工具"),
});

export async function apply(ctx: Context, config: Config) {
  if (config.basePath) {
    config.basePath = resolve(ctx.baseDir, config.basePath);
    if (!existsSync(config.basePath)) {
      mkdirSync(config.basePath, { recursive: true });
    }
  }
  ctx.plugin(ModelService, config as ModelServiceConfig);
  ctx.plugin(ExtensionService, config as ExtensionConfig);
  ctx.plugin(SessionService, config as SessionConfig);
  ctx.plugin(AdapterService, config as AdapterConfig);
  ctx.plugin(RuntimeService, config as RuntimeConfig);
  if (config.enableChatTools) {
    ctx.plugin(ChatHistoryPlugin, {
      sessionsDir: resolve(ctx.baseDir, config.basePath, "sessions"),
      isolation: false,
      defaultLimit: 20,
      maxLimit: 50,
    });
  }
}

export type { ModelService } from "./services/model";
export type { SessionService } from "./services/session";
export type { AthenaEvent, PlatformAdapter } from "./adapter/index.js";
export { encodeChannelId } from "./services/session/encoding.js";
export type {
  Channel,
  ChannelReloadResult,
  ChannelRuntime,
  ChannelRuntimeError,
  ExtensionBinding,
  ExtensionCleanup,
  ExtensionContext,
  ExtensionDefinition,
  ExtensionToolSnapshot,
  ReloadSummary,
  ToolDefinition,
} from "./extension/types.js";
