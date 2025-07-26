import { Schema } from "koishi";
import { AgentBehaviorConfig, AgentBehaviorConfigSchema } from "./agent";
import { LoggingConfig, LoggingConfigSchema } from "./services";
import { AssetServiceConfig, AssetServiceConfig as AssetServiceConfigSchema } from "./services/assets";
import { ToolServiceConfig, ToolServiceConfigSchema } from "./services/extension";
import { MemoryConfig, MemoryConfigSchema } from "./services/memory";
import { ModelServiceConfig, ModelServiceConfigSchema } from "./services/model";
import { HistoryConfig, HistoryConfigSchema } from "./services/worldstate";
import { ErrorReporterConfig, ErrorReporterConfigSchema } from "./shared/errors";

export interface SystemConfig {
    /** 平台服务缓存配置 */
    cache: {
        ttlSeconds: number;
        maxSize: number;
    };
    /** 全局日志配置 */
    logging: LoggingConfig;

    errorReporting: ErrorReporterConfig;
}

export const SystemConfigSchema: Schema<SystemConfig> = Schema.object({
    cache: Schema.object({
        ttlSeconds: Schema.number()
            .default(6 * 60 * 60)
            .description("缓存存活时间 (秒)"),
        maxSize: Schema.number().default(1000).description("缓存最大项目数"),
    }).description("平台服务缓存配置"),
    logging: LoggingConfigSchema.description("日志配置"),
    errorReporting: ErrorReporterConfigSchema.description("错误上报配置"),
});

// =================================================================
// 3. 根配置对象 (Root Configuration Object)
// =================================================================

export interface Config {
    /** AI 模型、API密钥和模型组配置 */
    modelService: ModelServiceConfig;
    /** 智能体的性格、唤醒和响应逻辑 */
    agentBehavior: AgentBehaviorConfig;
    /** 记忆、工具等扩展能力配置 */
    capabilities: {
        memory: MemoryConfig;
        /** 对话历史记录的管理方式 */
        history: HistoryConfig;
        tools: ToolServiceConfig;
    };
    /** 资源服务配置 */
    assetService: AssetServiceConfig;
    /** 系统缓存、调试等底层设置 */
    system: SystemConfig;
}

export const Config: Schema<Config> = Schema.object({
    modelService: ModelServiceConfigSchema.description("AI 模型、API密钥和模型组配置"),
    agentBehavior: AgentBehaviorConfigSchema,
    capabilities: Schema.object({
        memory: MemoryConfigSchema.description("记忆能力配置"),
        history: HistoryConfigSchema.description("历史记录管理"),
        tools: ToolServiceConfigSchema.description("工具能力配置"),
    }),
    assetService: AssetServiceConfigSchema.description("资源服务配置"),
    system: SystemConfigSchema,
});
