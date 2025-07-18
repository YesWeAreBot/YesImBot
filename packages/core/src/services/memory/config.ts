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
});