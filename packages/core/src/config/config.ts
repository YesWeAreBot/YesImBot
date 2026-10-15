import { Schema } from "koishi";

import { AgentBehaviorConfig, AgentBehaviorConfigSchema } from "../agent";
import { AssetServiceConfig, AssetServiceConfigSchema } from "../services/assets/config";
import { ToolServiceConfig, ToolServiceConfigSchema } from "../services/extension/config";
import { LoggingConfig, LoggingConfigSchema } from "../services/logger";
import { MemoryConfig, MemoryConfigSchema } from "../services/memory/config";
import { ModelServiceConfig, ModelServiceConfigSchema } from "../services/model/config";
import { PromptServiceConfig, PromptServiceConfigSchema } from "../services/prompt/config";
//import { TelemetryConfig, TelemetryConfigSchema } from "../services/telemetry";
import { HistoryConfig, HistoryConfigSchema } from "../services/worldstate/config";
import { ErrorReporterConfig, ErrorReporterConfigSchema } from "../shared/errors";

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

export const Config: Schema<Config> = Schema.intersect(
    [
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
        //TelemetryConfigSchema,
        SystemConfigSchema.collapse().description("系统设置"),
    ].map(configSection),
);

// Preserve flat configuration fields. Only top-level presentation metadata changes.
function configSection(schema: Schema): Schema {
    if (schema.type === "intersect" && !schema.meta.description) {
        return Schema.intersect((schema.list ?? []).map(configSection));
    }
    return schema.meta.description ? schema.role("yib-section") : schema;
}
