import { Schema } from "koishi";

export interface ToolServiceConfig {
    extra?: Record<string, { enabled?: boolean; [key: string]: any }>;
    /** 高级选项 */
    advanced?: {
        maxRetry?: number;
        retryDelay?: number;
        timeout?: number;
        toolTimeouts?: Record<string, number>;
    };
}

export const ToolServiceConfigSchema = Schema.object({
    extra: Schema.dynamic("toolService.availableExtensions").default({}),

    advanced: Schema.object({
        maxRetry: Schema.number().default(3).description("读取类工具的最大重试次数；发送和写操作不会自动重放"),
        retryDelay: Schema.number().default(1000).description("重试延迟时间（毫秒）"),
        timeout: Schema.number().min(0).default(10000).description("普通工具总超时（毫秒），0 使用默认的 10000 毫秒预算。识图、发送等慢工具使用各自预算"),
        toolTimeouts: Schema.dict(Schema.number().min(1))
            .default({})
            .description("按工具名覆盖总超时（毫秒），优先于工具自身预算；后台执行还受后台任务总上限约束"),
    })
        .collapse()
        .description("高级选项"),
});
