import { readFileSync } from "fs";
import { Schema } from "koishi";
import path from "path";

import { SystemConfig } from "@/config";
import { PROMPTS_DIR } from "@/shared/constants";

export const DEFAULT_SUMMARY_PROMPT = readFileSync(path.resolve(PROMPTS_DIR, "summary_system.txt"), "utf-8");

/**
 * 对话历史管理配置
 */
export interface HistoryConfig {
    /* === 总结 === */
    summarization: {
        /** 启用对话历史总结功能 */
        enabled: boolean;
        /** 用于生成对话摘要的提示词模板 */
        prompt: string;
        /** 当待总结的片段达到此数量时，触发总结任务 */
        triggerCount: number;
        /** 单次最少压缩的消息数量 */
        minTriggerMessages: number;
    };

    /* === 折叠 === */
    /** 在上下文中保留的最新"完整"对话片段数量 */
    fullContextSegmentCount: number;
    /** 上下文中最多包含的用户消息数 */
    maxMessages: number;
    inactivityTimeoutSec: number;

    /* === 召回 === */
    recall: {
        /** 私聊场景下召回用户画像的数量 */
        private: number;
        /** 群组场景下召回用户画像的数量 */
        guild: number;
        /** 最低置信度 */
        minConfidence: number;
    };

    /* === 清理 === */
    /** 历史数据在被永久删除前的最大保留天数 */
    dataRetentionDays: number;
    /** 后台清理任务的执行频率（秒） */
    cleanupIntervalSec: number;

    readonly allowedChannels?: Set<string>;
    readonly system?: SystemConfig;
}

export const HistoryConfigSchema: Schema<HistoryConfig> = Schema.object({
    summarization: Schema.object({
        enabled: Schema.boolean().default(true).description("启用对话历史总结功能"),
        prompt: Schema.string()
            .default(DEFAULT_SUMMARY_PROMPT)
            .role("textarea", { rows: [2, 4] })
            .description("用于生成对话摘要的提示词。"),
        triggerCount: Schema.number().default(6).description("当待总结的片段达到此数量时，触发总结任务"),
        minTriggerMessages: Schema.number().default(50).description("单次最少压缩的消息数量"),
    }).description("对话历史总结设置"),

    fullContextSegmentCount: Schema.number().default(2).description("在上下文中保留的最新完整对话片段数量"),
    maxSegmentLength: Schema.number().default(20).description("片段的最大长度（消息数）"),
    maxMessages: Schema.number().default(30).description("上下文中最多包含的消息数量"),

    inactivityTimeoutSec: Schema.number().default(1800).description("片段在多长时间内没有新消息后被关闭（秒）"),

    recall: Schema.object({
        private: Schema.number().default(3).description("私聊场景下召回用户画像的数量"),
        guild: Schema.number().default(3).description("群组场景下召回用户画像的数量"),
        minConfidence: Schema.number().default(0.5).description("最低置信度"),
    }).description("用户画像召回设置"),

    dataRetentionDays: Schema.number().default(30).description("历史数据在被永久删除前的最大保留天数"),
    cleanupIntervalSec: Schema.number().default(60).description("后台清理任务的执行频率（秒）"),
});
