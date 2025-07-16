import { Schema } from "koishi";

/**
 * PromptManager 配置接口
 */
export interface PromptManagerConfig {
    /** 片段执行的默认超时时间（毫秒）*/
    defaultTimeout?: number;
    /** 是否开启调试模式，输出更详细的日志 */
    debug?: boolean;
}

export const PromptManagerConfigSchema: Schema<PromptManagerConfig> = Schema.object({
    defaultTimeout: Schema.number().default(5000).description('片段执行的默认超时时间（毫秒）。'),
    debug: Schema.boolean().default(false).description('是否开启调试模式，输出更详细的日志。'),
});