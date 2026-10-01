import { Schema } from "koishi";

import { AgentBehaviorConfig, AgentBehaviorConfigSchema } from "@/agent";
import { AssetServiceConfig, AssetServiceConfigSchema } from "@/services/assets";
import { ToolServiceConfig, ToolServiceConfigSchema } from "@/services/extension";
import { LoggingConfig, LoggingConfigSchema } from "@/services/logger";
import { MemoryConfig, MemoryConfigSchema } from "@/services/memory";
import { ModelServiceConfig, ModelServiceConfigSchema } from "@/services/model";
import { PromptServiceConfig, PromptServiceConfigSchema } from "@/services/prompt";
//import { TelemetryConfig, TelemetryConfigSchema } from "@/services/telemetry";
import { HistoryConfig, HistoryConfigSchema } from "@/services/worldstate";
import { ErrorReporterConfig, ErrorReporterConfigSchema } from "@/shared/errors";

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

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        version: Schema.union([Schema.string(), Schema.number()]).hidden(),
    }),

    ModelServiceConfigSchema.description("模型服务"),
    AgentBehaviorConfigSchema,
    PromptServiceConfigSchema,

    MemoryConfigSchema.description("记忆能力配置"),
    HistoryConfigSchema,
    ToolServiceConfigSchema.description("工具能力配置"),

    AssetServiceConfigSchema.collapse().description("资源存储与处理"),
    //TelemetryConfigSchema,
    SystemConfigSchema.collapse().description("系统设置"),
]);
