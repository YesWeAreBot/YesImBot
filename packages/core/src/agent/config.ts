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
    /**
     * 计算意愿得分时不同触发方式的权重。
     * 分数会累加，总分达到阈值即可触发响应。
     */
    weights: {
        /** 被 @ 提及时增加的分数 */
        atMention: number;
        /** 包含关键词时增加的分数 */
        keyword: number;
        /** 包含普通文本消息时增加的分数 */
        textMessage: number;
        /** 包含图片时增加的分数 */
        imageMessage: number;
        /** 作为引用/回复出现时增加的分数 */
        quoteMessage: number;
        /** 由指令调用触发时增加的分数 (例如，其他插件或用户调用了与Agent交互的指令) */
        commandInvocation: number;
    };
    /** 触发意愿得分的关键词列表 */
    keywords: string[];
    /** 高级选项 */
    advanced: {
        /** 是否开启测试模式，将无视阈值直接响应 */
        testMode: boolean;
        /** 意愿得分每分钟衰减的量 */
        decayPerMinute: number;
        /** Agent 回复后，意愿得分保留的比例 (0-1) */
        retentionAfterReply: number;
    };
    readonly system?: SystemConfig;
}

export const WillingnessConfigSchema = Schema.object({
    threshold: Schema.number().default(0.5).min(0).max(1).description("意愿阈值。当分数累加超过此值时触发响应。"),
    weights: Schema.object({
        atMention: Schema.number().default(1).description("被 @ 提及时增加的分数。通常应较高以保证必回。"),
        keyword: Schema.number().default(0.3).description("命中关键词时增加的分数。"),
        textMessage: Schema.number().default(0.1).description("包含普通文本消息时增加的分数。"),
        imageMessage: Schema.number().default(0.15).description("包含图片时增加的分数。"),
        quoteMessage: Schema.number().default(0.2).description("作为引用/回复出现时增加的分数。"),
        commandInvocation: Schema.number().default(0.1).description("由指令调用触发时增加的分数。"),
    }).description("不同事件的权重(分数)配置"),
    keywords: Schema.array(Schema.string()).role("table").description("触发意愿的关键词。"),
    advanced: Schema.object({
        testMode: Schema.boolean().default(false).description("测试模式(强制回复)。"),
        decayPerMinute: Schema.number().default(0).description("每分钟意愿衰减值。"),
        retentionAfterReply: Schema.number().default(0.2).description("回复后意愿保留比例。"),
    })
        .collapse()
        .description("高级选项"),
});

/** 视觉与多模态相关配置 */
export interface VisionConfig {
    /** 是否启用视觉功能 */
    enabled: boolean;
    /** 允许的图片类型 */
    allowedImageTypes: string[];
    /** 允许在上下文中包含的最大图片数量 */
    maxImagesInContext: number;
    /**
     * 图片在上下文中的最大生命周期。
     * 一张图片在上下文中出现 N 次后将被视为“过期”，除非它被引用。
     */
    imageLifecycleCount: number;

    detail: "low" | "high" | "auto";
}

export const VisionConfigSchema: Schema<VisionConfig> = Schema.object({
    enabled: Schema.boolean().default(false).description("是否启用视觉功能"),
    allowedImageTypes: Schema.array(Schema.string()).default(["image/jpeg", "image/png"]).description("允许的图片类型"),
    maxImagesInContext: Schema.number().default(3).description("在上下文中允许包含的最大图片数量。"),
    imageLifecycleCount: Schema.number().default(2).description("图片的上下文生命周期（出现次数）。超过此次数的图片将被忽略，除非被引用。"),
    detail: Schema.union(["low", "high", "auto"]).default("low").description("图片细节程度"),
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
    heartbeat: Schema.number().min(1).max(10).default(5).role("slider").step(1).description("每轮对话最大心跳次数"),
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
    vision: VisionConfigSchema,
});
