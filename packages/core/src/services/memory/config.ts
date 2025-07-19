// src/services/memory/config.ts
import { Schema } from 'koishi';

/** 记忆服务配置 */
export interface MemoryConfig {
    coreMemoryPath: string;
    /** 批处理设置 */
    batching: {
        /** 只有大于这个数值才进行处理，避免上下文不够 */
        minSize: number;
        /** 单个用户积累多少条消息后立即处理 */
        maxSize: number;
        /** 用户最后一条消息发送后，等待多少秒进行处理 */
        maxWaitTime: number;
    };
    /** 记忆衰减设置 */
    forgetting: {
        /** 触发遗忘检查的周期（小时） */
        checkIntervalHours: number;
        /** 遗忘阈值：多久未访问的事实可被视为陈旧（天） */
        stalenessDays: number;
        /** 遗忘阈值：低于此显著性的事实才可能被遗忘 */
        salienceThreshold: number;
        /** 遗忘阈值：低于此访问次数的事实才可能被遗忘 */
        accessCountThreshold: number;
    };
    /** 用户画像生成设置 */
    profileGeneration: {
        /** 事实相关性阈值：低于此值的事实不参与画像生成 */
        factRelevanceThreshold: number;
        /** 总结字数限制：生成的用户画像最大字符数 */
        maxSummaryLength: number;
        /** 画像更新频率控制：最少间隔多少小时才能更新同一用户的画像 */
        updateIntervalHours: number;
        /** 最小事实数量：至少需要多少条新事实才触发画像更新 */
        minFactsForUpdate: number;
        /** 置信度阈值：低于此值的画像更新将被拒绝 */
        confidenceThreshold: number;
        /** 是否启用增量更新：只处理新增的事实而不是全部重新生成 */
        enableIncrementalUpdate: boolean;
        /** 关键事实权重：标记为关键的事实在画像生成中的权重倍数 */
        keyFactWeight: number;
    };
    /** 错误处理和重试设置 */
    errorHandling: {
        /** 最大重试次数 */
        maxRetries: number;
        /** 重试延迟（毫秒） */
        retryDelayMs: number;
        /** 操作锁超时时间（毫秒） */
        lockTimeoutMs: number;
        /** 熔断器失败阈值 */
        circuitBreakerThreshold: number;
        /** 熔断器重置时间（毫秒） */
        circuitBreakerResetMs: number;
    };
}

export const MemoryConfig: Schema<MemoryConfig> = Schema.object({
    coreMemoryPath: Schema.path({ allowCreate: true, filters: ["directory"] })
        .default("data/yesimbot/memory/core")
        .description("核心记忆文件的存放路径。"),
    batching: Schema.object({
        minSize: Schema.number().default(5).min(1).description("只有大于这个数值才进行处理，避免上下文缺失"),
        maxSize: Schema.number().default(10).min(1).description("单个用户积累多少条消息后立即处理，以应对短时大量消息"),
        maxWaitTime: Schema.number().default(60).min(5).description("用户最后一条消息发送后，等待多少秒进行处理"),
    }).description("消息批处理设置"),

    forgetting: Schema.object({
        checkIntervalHours: Schema.number().default(24).description("触发遗忘检查的周期（小时）。"),
        stalenessDays: Schema.number().default(90).description("多久未访问的事实可被视为陈旧（天）。"),
        salienceThreshold: Schema.number().default(0.3).max(1).min(0).description("低于此显著性的事实才可能被遗忘。"),
        accessCountThreshold: Schema.number().default(2).description("低于此访问次数的事实才可能被遗忘。"),
    }).description("记忆衰减与遗忘设置"),

    profileGeneration: Schema.object({
        factRelevanceThreshold: Schema.number().default(0.3).min(0).max(1).description("事实相关性阈值：低于此值的事实不参与画像生成"),
        maxSummaryLength: Schema.number().default(500).min(100).max(2000).description("总结字数限制：生成的用户画像最大字符数"),
        updateIntervalHours: Schema.number().default(6).min(1).max(168).description("画像更新频率控制：最少间隔多少小时才能更新同一用户的画像"),
        minFactsForUpdate: Schema.number().default(3).min(1).max(20).description("最小事实数量：至少需要多少条新事实才触发画像更新"),
        confidenceThreshold: Schema.number().default(0.6).min(0).max(1).description("置信度阈值：低于此值的画像更新将被拒绝"),
        enableIncrementalUpdate: Schema.boolean().default(true).description("是否启用增量更新：只处理新增的事实而不是全部重新生成"),
        keyFactWeight: Schema.number().default(1.5).min(1).max(3).description("关键事实权重：标记为关键的事实在画像生成中的权重倍数"),
    }).description("用户画像生成设置"),

    errorHandling: Schema.object({
        maxRetries: Schema.number().default(3).min(0).max(10).description("最大重试次数"),
        retryDelayMs: Schema.number().default(1000).min(100).max(10000).description("重试延迟（毫秒）"),
        lockTimeoutMs: Schema.number().default(30000).min(5000).max(300000).description("操作锁超时时间（毫秒）"),
        circuitBreakerThreshold: Schema.number().default(5).min(1).max(20).description("熔断器失败阈值"),
        circuitBreakerResetMs: Schema.number().default(60000).min(10000).max(600000).description("熔断器重置时间（毫秒）"),
    }).description("错误处理和重试设置"),
});
