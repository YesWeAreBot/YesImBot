import { Schema } from "koishi";
import { AgentBehaviorConfig, AgentBehaviorConfigSchema } from "./agent";
import { ToolServiceConfig, ToolServiceConfigSchema } from "./services/extensions";
import { ImageServiceConfig, ImageServiceConfigSchema } from "./services/image";
import { MemoryConfig, MemoryConfigSchema } from "./services/memory";
import { ModelServiceConfig, ModelServiceConfigSchema } from "./services/model";
import { HistoryConfig, HistoryConfigSchema } from "./services/worldstate";

/**
 * 定义日志级别
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 全局日志配置
 */
export interface LoggingConfig {
    /**
     * 全局日志级别。各个服务可以有自己的覆盖设置。
     * UI 建议: 一个下拉菜单
     */
    level: LogLevel;

    /**
     * 是否在 Agent 响应中包含详细的决策过程信息。
     * 这个配置与 Agent 行为紧密相关，但从控制日志的角度看，放在这里作为全局开关更合适。
     */
    logDecisionDetails: boolean;
}

export interface SystemConfig {
    /** 平台服务缓存配置 */
    cache: {
        ttlSeconds: number;
        maxSize: number;
    };
    /** 全局日志配置 */
    logging: LoggingConfig;
    /** 调试与诊断 */
    debug: {
        /**
         * 启用全局调试模式。会覆盖 logging.level 为 'debug'。
         * 这通常意味着更详细的内部状态输出。
         */
        enable: boolean;
        /** 应用出错时自动上报详细日志给开发者 */
        uploadDump: boolean;
    };
}

export const SystemConfigSchema: Schema<SystemConfig> = Schema.object({
    cache: Schema.object({
        ttlSeconds: Schema.number()
            .default(6 * 60 * 60)
            .description("缓存存活时间 (秒)"),
        maxSize: Schema.number().default(1000).description("缓存最大项目数"),
    }).description("平台服务缓存配置"),
    logging: Schema.object({
        level: Schema.union(["debug", "info", "warn", "error"]).default("info").description("全局日志级别"),
        logDecisionDetails: Schema.boolean().default(false).description("在 Agent 响应中包含详细的决策过程信息"),
    }).description("日志配置"),
    debug: Schema.object({
        enable: Schema.boolean().default(false).description("启用全局调试模式"),
        uploadDump: Schema.boolean().default(false).description("应用出错时自动上报详细日志给开发者（包含聊天内容和 LLM 输出）"),
    }).description("调试与诊断"),
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
        tools: ToolServiceConfig;
        /** 对话历史记录的管理方式 */
        history: HistoryConfig;
    };
    /** 图片服务配置 */ // 新增
    imageService: ImageServiceConfig; // 新增
    /** 系统缓存、调试等底层设置 */
    system: SystemConfig;
}

export const Config: Schema<Config> = Schema.object({
    modelService: ModelServiceConfigSchema.description("AI 模型、API密钥和模型组配置"),
    agentBehavior: AgentBehaviorConfigSchema,
    capabilities: Schema.object({
        memory: MemoryConfigSchema.description("记忆能力配置"),
        tools: ToolServiceConfigSchema.description("工具能力配置"),
        history: HistoryConfigSchema.description("对话历史记录的管理方式"),
    }),
    imageService: ImageServiceConfigSchema.description("图片服务配置"),
    system: SystemConfigSchema,
});
