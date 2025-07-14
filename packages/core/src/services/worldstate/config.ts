import { readFileSync } from "fs";
import { Schema } from "koishi";
import path from "path";

import { SystemConfig } from "@/config";
import { PROMPTS_DIR } from "@/shared/constants";

export const DEFAULT_SUMMARY_PROMPT = readFileSync(path.resolve(PROMPTS_DIR, "summary_system.txt"), "utf-8");

/**
 * 对话历史管理配置 (原 WorldState)
 * UI 建议: 标题就叫“历史记录管理”。
 */
export interface HistoryConfig {
    /** 启用对话历史总结功能 */
    enableSummarization: boolean;
    /** 用于生成对话摘要的提示词模板。必须包含 `{dialogueText}`。 */
    summarizationPrompt: string;
    /** 在上下文中保留的最新“完整”对话片段数量 */
    fullContextSegmentCount: number;
    /** 当待总结的片段达到此数量时，触发总结任务 */
    summarizationTriggerCount: number;
    /** 高级选项 */
    advanced: {
        /** 每个频道在上下文中最多包含的历史项目数 */
        maxHistoryItemsPerChannel: number;
        /** 上下文中最多包含的用户消息数 */
        maxMessages: number;
        /** 历史数据在被永久删除前的最大保留天数 */
        dataRetentionDays: number;
        /** 后台清理任务的执行频率（毫秒） */
        cleanupIntervalMs: number;
    };
    readonly allowedChannels?: Set<string>;
    readonly system?: SystemConfig;
}

export const HistoryConfigSchema: Schema<HistoryConfig> = Schema.object({
    enableSummarization: Schema.boolean().default(true).description("启用对话历史总结功能"),
    summarizationPrompt: Schema.string()
        .default(DEFAULT_SUMMARY_PROMPT)
        .role("textarea", { rows: [2, 4] })
        .description("用于生成对话摘要的提示词。"),
    fullContextSegmentCount: Schema.number().default(2).description("在上下文中保留的最新“完整”对话片段数量"),
    summarizationTriggerCount: Schema.number().default(6).description("当待总结的片段达到此数量时，触发总结任务"),
    advanced: Schema.object({
        maxHistoryItemsPerChannel: Schema.number().default(15).description("每个频道在上下文中最多包含的历史项目数"),
        maxMessages: Schema.number().min(1).default(30).description("上下文中最多包含的用户消息数"),
        dataRetentionDays: Schema.number().default(30).description("历史数据在被永久删除前的最大保留天数"),
        cleanupIntervalMs: Schema.number().default(60000).description("后台清理任务的执行频率（毫秒）"),
    })
        .collapse()
        .description("高级选项"),
});
