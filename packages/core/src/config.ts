import { Schema } from "koishi";
import { AgentBehaviorConfig, AgentBehaviorConfigSchema } from "./agent";
import { LoggingConfig, LoggingConfigSchema, PromptServiceConfig, PromptServiceConfigSchema } from "./services";
import { AssetServiceConfig, AssetServiceConfig as AssetServiceConfigSchema } from "./services/assets";
import { ToolServiceConfig, ToolServiceConfigSchema } from "./services/extension";
import { MemoryConfig, MemoryConfigSchema } from "./services/memory";
import { ModelServiceConfig, ModelServiceConfigSchema } from "./services/model";
import { HistoryConfig, HistoryConfigSchema } from "./services/worldstate";
import { ErrorReporterConfig, ErrorReporterConfigSchema } from "./shared/errors";

export interface SystemConfig {
    logging: LoggingConfig;
    errorReporting: ErrorReporterConfig;
}

export const SystemConfigSchema: Schema<SystemConfig> = Schema.object({
    logging: LoggingConfigSchema,
    errorReporting: ErrorReporterConfigSchema,
});

export type Config = ModelServiceConfig &
    AgentBehaviorConfig &
    MemoryConfig &
    HistoryConfig &
    ToolServiceConfig &
    AssetServiceConfig &
    PromptServiceConfig &
    SystemConfig;

export const Config: Schema<Config> = Schema.intersect([
    ModelServiceConfigSchema.description("AI 模型、API密钥和模型组配置"),
    AgentBehaviorConfigSchema,

    MemoryConfigSchema.description("记忆能力配置"),
    HistoryConfigSchema.description("历史记录管理"),
    ToolServiceConfigSchema.description("工具能力配置"),

    AssetServiceConfigSchema.description("资源服务配置"),
    PromptServiceConfigSchema,
    SystemConfigSchema.description("系统设置"),
]);
