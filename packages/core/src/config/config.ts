import { Schema } from "koishi";

import { AgentBehaviorConfig } from "@/agent";
import { AssetServiceConfig } from "@/services/assets";
import { MemoryConfig } from "@/services/memory";
import { ModelServiceConfig } from "@/services/model";
import { ToolServiceConfig } from "@/services/plugin";
import { PromptServiceConfig } from "@/services/prompt";
import { TelemetryConfig } from "@/services/telemetry";
import { HistoryConfig } from "@/services/world";

export const CONFIG_VERSION = "2.0.2";

export type Config = ModelServiceConfig
    & AgentBehaviorConfig
    & MemoryConfig
    & HistoryConfig
    & ToolServiceConfig
    & AssetServiceConfig
    & PromptServiceConfig & {
        telemetry: TelemetryConfig;
        logLevel: 1 | 2 | 3;
        version?: string;
    };

export const Config: Schema<Config> = Schema.intersect([
    ModelServiceConfig.description("模型服务"),
    AgentBehaviorConfig,

    MemoryConfig.description("记忆能力配置"),
    HistoryConfig.description("历史记录管理"),
    ToolServiceConfig.description("工具能力配置"),

    AssetServiceConfig.description("资源服务配置"),
    PromptServiceConfig,
    Schema.object({
        telemetry: TelemetryConfig.description("错误上报配置"),
        logLevel: Schema.union([
            Schema.const(1).description("错误"),
            Schema.const(2).description("信息"),
            Schema.const(3).description("调试"),
        ])
            .default(2)
            .description("日志等级"),
        version: Schema.string().hidden(),
    }),
]);
