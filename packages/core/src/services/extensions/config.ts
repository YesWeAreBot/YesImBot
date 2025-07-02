import { Schema } from "koishi";
import { SystemConfig } from "../../config";

/** 工具服务配置 */
export interface ToolServiceConfig {
    /** 是否在启动时自动加载工具 */
    autoLoad?: boolean;
    /** 工具扩展所在的路径 */
    extensionPaths?: string[];
    /** 高级选项 */
    advanced: {
        maxRetry?: number;
        retryDelayMs?: number;
        timeoutMs?: number;
        hotReload?: boolean;
        validateTypes?: boolean;
    };
    readonly system?: SystemConfig;
}

export const ToolServiceConfigSchema: Schema<ToolServiceConfig> = Schema.object({
    autoLoad: Schema.boolean().default(true).description("是否在启动时自动加载工具"),
    extensionPaths: Schema.array(Schema.string()).default([]).description("工具扩展所在的路径"),
    advanced: Schema.object({
        maxRetry: Schema.number().default(3).description("最大重试次数"),
        retryDelayMs: Schema.number().default(1000).description("重试延迟时间"),
        timeoutMs: Schema.number().default(10000).description("超时时间"),
        hotReload: Schema.boolean().default(false).description("是否启用热重载"),
        validateTypes: Schema.boolean().default(true).description("是否验证类型"),
    }),
});
