import { Schema } from "koishi";

export interface WorldStateConfig {
    /**
     * @description 世界状态历史数据的最终保留天数。超过此天数的已总结记录将被归档并最终删除。
     */
    DataRetentionDays: number;
    /**
     * @description 在为 Agent 构建上下文时，每个频道允许包含的最大历史项目数（对话片段 + Agent 回合）。
     */
    MaxHistoryItemsPerChannel: number;
    /**
     * @description 在历史记录压缩时，最少需要保留的 Agent 回合数。这可以确保 Agent 始终能看到自己最近的几次行动。
     */
    MinAgentTurnsToKeep: number;
    /**
     * @description 当历史记录超出限制，旧的 Agent 回合被移除后，其关联的对话片段会变为 'folded' 状态。此配置项定义了在触发“总结”操作之前，一个频道内最多可以容纳多少个 'folded' 状态的片段。
     */
    MaxFoldedSegments: number;
    /**
     * @description 是否启用对话片段的自动总结功能。
     */
    EnableSummarization: boolean;
    /**
     * @description 用于生成对话片段摘要的语言模型名称。
     */
    SummarizationModel: string;
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
        .description("在为 Agent 构建上下文时，每个频道允许包含的最大历史项目数（对话片段 + Agent 回合）。"),
    MinAgentTurnsToKeep: Schema.number().min(0).max(10).default(3).description("在历史记录压缩时，最少需要保留的 Agent 回合数。"),
    MaxFoldedSegments: Schema.number()
        .min(1)
        .max(50)
        .default(5)
        .description("一个频道内允许存在的最大 'folded' 状态片段数，超出部分将被总结。"),
    EnableSummarization: Schema.boolean().default(true).description("是否启用对话片段的自动总结功能。"),
    SummarizationModel: Schema.string().default("moonshot-v1-8k").description("用于生成对话片段摘要的语言模型名称。"),
    SummarizationPrompt: Schema.string()
        .role("textarea")
        .default(
            "你是一个对话总结助手。请根据以下对话记录，用一句话凝练地总结对话的核心内容、关键信息或主要问题。忽略闲聊，聚焦于事实、决策和未解决的问题。\n\n对话记录：\n{dialogueText}"
        )
        .description("用于生成对话片段摘要的提示词模板。必须包含 `{dialogueText}`占位符。"),
    CleanupInterval: Schema.number().min(60000).default(3600000).description("后台清理任务（归档、删除旧数据）的执行频率（毫秒）。"),
}).description("世界状态服务配置");
