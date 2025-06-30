import { Schema } from "koishi";
import { SystemBaseTemplate, UserBaseTemplate } from "./prompt-builder";
import { WillingnessConfig } from "./willingness-calculator";

interface ArousalConfig {
    AllowedChannelGroups: {
        Platform: string;
        Id: string;
    }[][];
    DebounceMs: number;
}

interface ToolExecutorConfig {
    MaxRetry: number;
}

export interface AgentConfig {
    Arousal: ArousalConfig;
    Willingness: WillingnessConfig;
    Chat: {
        UseGroup: string;
        MaxHeartbeat: number;
    };
    ToolExecutor: ToolExecutorConfig;
    Prompt: {
        SystemTemplate: string;
        UserTemplate: string;
    };
    Debug: {
        LogDecisionDetails: boolean;
    };
}

export const AgentConfigSchema: Schema<AgentConfig> = Schema.object({
    Arousal: Schema.object({
        AllowedChannelGroups: Schema.array(
            Schema.array(
                Schema.object({
                    Platform: Schema.string().description("平台名称"),
                    Id: Schema.string().description("频道ID"),
                })
            ).role("table")
        ).description("允许 Agent 响应的频道分组。同一组内的频道共享上下文。"),
        DebounceMs: Schema.number().default(2000).description("唤醒决策的防抖延迟（毫秒）。"),
    }).description("唤醒机制配置"),

    Willingness: Schema.object({
        TestMode: Schema.boolean().default(false).description("【调试】测试模式，所有来自允许频道的消息都将触发响应。"),
        AtMentionProbability: Schema.number().min(0).max(1).default(1.0).role("slider").description("当被@时，直接触发响应的概率。"),
        Threshold: Schema.number().min(0).max(1).default(0.7).role("slider").description("触发 Agent 行动的意愿值阈值。"),
        Weight: Schema.object({
            BaseMessage: Schema.number().default(0.1).description("每条普通消息增加的基础意愿值。"),
            AtMention: Schema.number().default(0.8).description("被@时增加的基础意愿值。"),
            Keyword: Schema.number().default(0.5).description("消息包含关键词时增加的基础意愿值。"),
        }).description("意愿值权重"),
        DecayPerMinute: Schema.number().default(0.2).description("意愿值每分钟自然衰减的量。"),
        RetentionAfterReply: Schema.number().min(0).max(1).default(0.3).role("slider").description("Agent 回复后，保留的意愿值比例。"),
        Keywords: Schema.array(String).role("table").description("能够显著提升意愿值的关键词列表。"),
    }).description("意愿度模型配置"),

    Chat: Schema.object({
        UseGroup: Schema.string().default("default").description("使用的模型组名称。"),
        MaxHeartbeat: Schema.number().min(1).max(6).default(2).step(1).role("slider").description("最大心跳次数，控制对话的活跃度"),
    }).description("对话行为配置"),

    ToolExecutor: Schema.object({
        MaxRetry: Schema.number().default(2).description("工具调用失败时的最大重试次数。"),
    }).description("工具执行器配置"),

    Prompt: Schema.object({
        SystemTemplate: Schema.string()
            .role("textarea", { rows: [4, 8] })
            .default(SystemBaseTemplate)
            .description("系统提示词模板。"),
        UserTemplate: Schema.string()
            .role("textarea", { rows: [4, 8] })
            .default(UserBaseTemplate)
            .description("用户提示词模板。"),
    }).description("提示词模板配置"),

    Debug: Schema.object({
        LogDecisionDetails: Schema.boolean().default(true).description("在控制台打印详细的意愿决策过程。"),
    }).description("调试配置"),
});
