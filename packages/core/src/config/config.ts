import { Schema } from "koishi";

import { AgentBehaviorConfig, AgentBehaviorConfigSchema } from "../agent";
import { AssetServiceConfig, AssetServiceConfigSchema } from "../asset";
import { ToolServiceConfig, ToolServiceConfigSchema } from "../extension";
import { LoggingConfig, LoggingConfigSchema } from "../logger";
import { MemoryConfig, MemoryConfigSchema } from "../memory";
import { ModelServiceConfig, ModelServiceConfigSchema } from "../model";
import { PromptServiceConfig, PromptServiceConfigSchema } from "../prompt";
//import { TelemetryConfig, TelemetryConfigSchema } from "../telemetry";
import { ErrorReporterConfig, ErrorReporterConfigSchema } from "../shared/errors";
import { HistoryConfig, HistoryConfigSchema } from "../world";

export const CONFIG_VERSION = "2.0.1";

export interface SystemConfig {
    logging: LoggingConfig;
    errorReporting: ErrorReporterConfig;
}

export const SystemConfigSchema: Schema<SystemConfig> = Schema.object({
    logging: LoggingConfigSchema.description("日志设置"),
    errorReporting: ErrorReporterConfigSchema.collapse().description("错误上报"),
});

export type Config = ModelServiceConfig &
    AgentBehaviorConfig &
    MemoryConfig &
    HistoryConfig &
    ToolServiceConfig &
    AssetServiceConfig &
    PromptServiceConfig &
    //TelemetryConfig &
    SystemConfig & {
        readonly version: string | number;
    };

// Layout is a client view over this unchanged runtime schema. Dynamic extension
// schemas remain owned by ToolService and are resolved live by the console.
export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        version: Schema.union([Schema.string(), Schema.number()]).hidden(),
    }),
    ModelServiceConfigSchema.description("模型服务"),
    AgentBehaviorConfigSchema,
    PromptServiceConfigSchema,
    MemoryConfigSchema.description("核心记忆文件"),
    HistoryConfigSchema,
    ToolServiceConfigSchema.description("工具与扩展"),
    AssetServiceConfigSchema.collapse().description("资源存储与处理"),
    SystemConfigSchema.collapse().description("系统设置"),
]).role("yib-settings");
