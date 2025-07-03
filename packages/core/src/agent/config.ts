import { Schema } from "koishi";
import { SystemConfig } from "../config";
import { MultiModalSystemBaseTemplate, SystemBaseTemplate, UserBaseTemplate } from "./prompt-builder";

// ------------------- 模块二: 智能体行为 (Agent Behavior) -------------------

export type ChannelDescriptor = {
    platform: string;
    id: string;
};

/** Agent 的唤醒条件配置 */
export interface ArousalConfig {
    /**
     * 允许 Agent 响应的频道。
     * 这是一个 "OR" 关系的列表，其中每个子列表是 "AND" 关系。
     * UI 建议: 提供一个可动态增减的列表，每个列表项里又能动态增减频道，会非常直观。
     */
    allowedChannelGroups: ChannelDescriptor[][];
    /** 消息防抖时间 (毫秒)，防止短时间内对相同模式的重复响应 */
    debounceMs: number;
}

export const ArousalConfigSchema = Schema.object({
    allowedChannelGroups: Schema.array(
        Schema.array(
            Schema.object({
                platform: Schema.string().required().description("平台"),
                id: Schema.string().required().description("频道 ID"),
            })
        ).role("table")
    )
        .required()
        .description("允许 Agent 响应的频道"),
    debounceMs: Schema.number().default(1000).description("消息防抖时间 (毫秒)"),
});

/** Agent 的响应意愿配置 (决定是否响应) */
export interface WillingnessConfig {
    /** 意愿得分超过此阈值时，Agent 才会响应 */
    threshold: number;
    /** 计算意愿得分时不同触发方式的权重 */
    weights: {
        /** 基础消息的权重 */
        baseMessage: number;
        /** 被 @ 提及时增加的权重 */
        atMention: number;
        /** 命中关键词时增加的权重 */
        keyword: number;
    };
    /** 触发意愿得分的关键词列表 */
    keywords: string[];
    /** 高级选项 */
    advanced: {
        /** 是否开启测试模式，将无视阈值直接响应 */
        testMode: boolean;
        /** 被 @ 提及时，有多大概率会无视阈值强制响应 (0-1) */
        atMentionProbability: number;
        /** 意愿得分每分钟衰减的百分比 (0-1) */
        decayPerMinute: number;
        /** Agent 回复后，意愿得分保留的比例 (0-1) */
        retentionAfterReply: number;
    };
}

export const WillingnessConfigSchema = Schema.object({
    threshold: Schema.number().default(0.5).description("意愿阈值"),
    weights: Schema.object({
        baseMessage: Schema.number().default(1).description("基础消息权重"),
        atMention: Schema.number().default(1).description("被 @ 提及权重"),
        keyword: Schema.number().default(1).description("命中关键词权重"),
    }),
    keywords: Schema.array(Schema.string()).role("table").description("触发意愿的关键词"),
    advanced: Schema.object({
        testMode: Schema.boolean().default(false).description("测试模式"),
        atMentionProbability: Schema.number().default(0.5).description("被 @ 提及概率"),
        decayPerMinute: Schema.number().default(0.01).description("每分钟意愿衰减"),
        retentionAfterReply: Schema.number().default(0.5).description("回复后意愿保留"),
    })
        .collapse()
        .description("高级选项"),
});

/** [新增] 视觉与多模态相关配置 */
export interface VisionConfig {
    /** 允许在上下文中包含的最大图片数量 */
    maxImagesInContext: number;
    /**
     * 图片在上下文中的最大生命周期。
     * 一张图片在上下文中出现 N 次后将被视为“过期”，除非它被引用。
     */
    imageLifecycleCount: number;

    detail: "low"  | "high" | "auto"
}

export const VisionConfigSchema: Schema<VisionConfig> = Schema.object({
    maxImagesInContext: Schema.number().default(3).description("在上下文中允许包含的最大图片数量。"),
    imageLifecycleCount: Schema.number().default(2).description("图片的上下文生命周期（出现次数）。超过此次数的图片将被忽略，除非被引用。"),
    detail: Schema.union(["low", "high", "auto"]).default("auto").description("图片细节程度"),
}).description("视觉与多模态配置");

/**
 * 智能体行为总体配置
 * UI 建议: 分成 "唤醒条件" 和 "响应意愿" 两个子板块。
 */
export interface AgentBehaviorConfig {
    arousal: ArousalConfig;
    willingness: WillingnessConfig;
    heartbeat: number;
    prompt: {
        systemTemplate: string;
        userTemplate: string;
        // 新增多模态系统提示词，使其可配置
        multiModalSystemTemplate: string;
    };
    vision: VisionConfig;
    readonly system?: SystemConfig;
}

export const AgentBehaviorConfigSchema: Schema<AgentBehaviorConfig> = Schema.object({
    arousal: ArousalConfigSchema.description("唤醒条件"),
    willingness: WillingnessConfigSchema.description("响应意愿"),
    heartbeat: Schema.number().min(1).max(10).default(3).role("slider").step(1).description("每轮对话最大心跳次数"),
    prompt: Schema.object({
        systemTemplate: Schema.string()
            .default(SystemBaseTemplate)
            .role("textarea", { rows: [2, 4] })
            .description("系统提示词模板"),
        userTemplate: Schema.string()
            .default(UserBaseTemplate)
            .role("textarea", { rows: [2, 4] })
            .description("用户提示词模板"),
        multiModalSystemTemplate: Schema.string()
            .default(MultiModalSystemBaseTemplate)
            .role("textarea", { rows: [2, 4] })
            .description("多模态系统提示词 (用于向模型解释图片占位符)"),
    }).description("提示词模板"),
    /** [新增] 视觉配置 Schema */
    vision: VisionConfigSchema,
});
