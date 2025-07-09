import { SystemConfig } from "@/config";
import { Schema } from "koishi";

export interface ToolServiceConfig {
    extensionConfigs?: Record<string, { enabled?: boolean; config?: any }>;
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

export const ToolServiceConfigSchema = Schema.object({
    extensionConfigs: Schema.dynamic("toolService.availableExtensions").default({}).description("扩展配置"),

    advanced: Schema.object({
        maxRetry: Schema.number().default(3).description("最大重试次数"),
        retryDelayMs: Schema.number().default(1000).description("重试延迟时间"),
        timeoutMs: Schema.number().default(10000).description("超时时间"),
        hotReload: Schema.boolean().default(false).description("是否启用热重载"),
        validateTypes: Schema.boolean().default(true).description("是否验证类型"),
    })
        .collapse()
        .description("高级选项"),
});
