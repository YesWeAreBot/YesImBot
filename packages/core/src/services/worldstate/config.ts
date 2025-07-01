import { Schema } from "koishi";

export interface WorldStateConfig {
    /**
     * @description 世界状态历史数据的最终保留天数。超过此天数的已总结记录将被归档并最终删除。
     */
    DataRetentionDays: number;
    /**
     * @description 在为 Agent 构建上下文时，每个频道允许包含的最大历史项目数（完整 + 折叠 + 总结）。
     */
    MaxHistoryItemsPerChannel: number;
    /**
     * @description 在上下文中，需要保持为“完整”状态（full context）的最新对话片段数量。这些片段的 Agent 回合将被完整保留。超出此数量的旧片段将被“折叠”（folded）。
     */
    FullContextSegmentCount: number;
    /**
     * @description 当 'folded' 状态的片段数量达到此阈值时，将触发后台的“总结”（summarization）任务。
     */
    SummarizationTriggerCount: number;
    /**
     * @description 是否启用对话片段的自动总结功能。
     */
    EnableSummarization: boolean;
    /**
     * @description 用于生成对话片段摘要的提示词模板。必须包含 `{dialogueText}` 占位符。
     */
    SummarizationPrompt: string;
    /**
     * @description 后台清理任务的执行频率（毫秒）。
     */
    CleanupInterval: number;
}

export const WorldStateConfigSchema: Schema<WorldStateConfig> = Schema.object({
    DataRetentionDays: Schema.number()
        .min(1)
        .default(30)
        .description("世界状态历史数据的最终保留天数。超过此天数的已总结记录将被归档并最终删除。"),
    MaxHistoryItemsPerChannel: Schema.number()
        .min(5)
        .max(100)
        .default(20)
        .description("在为 Agent 构建上下文时，每个频道允许包含的最大历史项目数（完整 + 折叠 + 总结）。"),
    FullContextSegmentCount: Schema.number()
        .min(1)
        .max(20)
        .default(3)
        .description("保持为“完整”状态的最新对话片段数量。超出部分将被折叠。"),
    SummarizationTriggerCount: Schema.number().min(2).max(50).default(10).description("触发“总结”任务的 'folded' 状态片段数量阈值。"),
    EnableSummarization: Schema.boolean().default(true).description("是否启用对话片段的自动总结功能。"),
    SummarizationPrompt: Schema.string()
        .role("textarea")
        .default(
            "你是一个对话总结助手。请根据以下多段对话记录，用一段话凝练地总结对话的核心内容、关键信息或主要问题。忽略闲聊，聚焦于事实、决策和未解决的问题。\n\n对话记录：\n{dialogueText}"
        )
        .description("用于生成对话片段摘要的提示词模板。必须包含 `{dialogueText}`占位符。"),
    CleanupInterval: Schema.number().min(60000).default(3600000).description("后台清理任务（总结、归档、删除旧数据）的执行频率（毫秒）。"),
}).description("世界状态服务配置");
