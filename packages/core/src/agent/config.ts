import { readFileSync } from "fs";
import { Computed, Schema } from "koishi";
import path from "path";

import { SystemConfig } from "@/config";
import { PROMPTS_DIR } from "@/shared/constants";

// 默认的系统和用户模板文件路径
export const SystemBaseTemplate = readFileSync(path.resolve(PROMPTS_DIR, "memgpt_v2_chat.txt"), "utf-8");
export const UserBaseTemplate = readFileSync(path.resolve(PROMPTS_DIR, "user_base.txt"), "utf-8");
export const MultiModalSystemBaseTemplate = `Images that appear in the conversation will be provided first, numbered in the format 'Image #[ID]:'.
In the subsequent conversation text, placeholders in the format <img id="[ID]" /> will be used to refer to these images.
Please participate in the conversation considering the full context of both images and text.
If image data is not provided, use \`get_image_description\` to describe the image.`;

export type ChannelDescriptor = {
    platform: string;
    type: "private" | "guild";
    id: string;
};

/** Agent 的唤醒条件配置 */
export interface ArousalConfig {
    /**
     * 允许 Agent 响应的频道。
     * 这是一个 "OR" 关系的列表。
     */
    allowedChannels: ChannelDescriptor[];
    /** 消息防抖时间 (毫秒)，防止短时间内对相同模式的重复响应 */
    debounceMs: number;
}

export const ArousalConfigSchema: Schema<ArousalConfig> = Schema.object({
    allowedChannels: Schema.array(
        Schema.object({
            platform: Schema.string().required().description("平台"),
            type: Schema.union([Schema.const("private").description("私聊"), Schema.const("guild").description("群组")])
                .default("guild")
                .description("频道类型"),
            id: Schema.string().required().description("频道 ID"),
        })
    )
        .role("table")
        .default([{ platform: "onebot", type: "guild", id: "*" }])
        .description("允许 Agent 响应的频道。使用 * 作为通配符"),
    debounceMs: Schema.number().default(1000).description("消息防抖时间 (毫秒)"),
});

/** Agent 的响应意愿配置 (决定是否响应) */
export interface WillingnessConfig {
    // --- A. 基础分数 (Base Scores) ---
    // 定义不同消息类型的"基础反应分"。它们通常是互斥的。

    base: {
        /** 收到普通文本消息的基础分。这是对话的基石 */
        text: Computed<number>;
        /** 收到图片消息的基础分。可以设为负数让AI不爱理睬图片 */
        //image: Computed<number>;
        /** 收到表情/贴纸的基础分。通常较低 */
        //emoji: Computed<number>;
    };

    // --- B. 属性加成 (Attribute Bonuses) ---
    // 如果消息满足以下属性，在基础分之上额外增加的分数。可以叠加。
    attribute: {
        /** 被 @ 提及时的额外加成。这是最高优先级的信号 */
        atMention: Computed<number>;
        /** 作为"回复/引用"出现时的额外加成。表示对话正在延续 */
        isQuote: Computed<number>;
        /** 在私聊场景下的额外加成。私聊通常期望更高的响应度 */
        isDirectMessage: Computed<number>;
    };

    // --- C. 兴趣度模型 (Interest Model) ---
    // 基于内容计算一个乘数，影响最终得分。
    interest: {
        /** 触发"高兴趣"的关键词列表 */
        keywords: Computed<string[]>;
        /** 消息包含关键词时，应用此乘数。>1 表示增强，<1 表示削弱 */
        keywordMultiplier: Computed<number>;
        /** 默认乘数（当没有关键词匹配时）。设为1表示不影响 */
        defaultMultiplier: Computed<number>;
    };

    // --- D. 意愿转换与生命周期 (Lifecycle & Conversion) ---
    lifecycle: {
        /** 意愿值的最大上限 */
        maxWillingness: Computed<number>;
        /** 意愿值衰减到一半所需的时间（秒）。这是一个基础值，会受对话热度影响 */
        decayHalfLifeSeconds: Computed<number>;
        /** 将意愿值转换为回复概率的"激活门槛" */
        probabilityThreshold: Computed<number>;
        /** 超过门槛后，转换为概率时的放大系数 */
        probabilityAmplifier: Computed<number>;
        /** 决定回复后，扣除的"发言精力惩罚"基础值 */
        replyCost: Computed<number>;
        /**
         * 回复后的一段“不应期”（毫秒），在此期间不会再次响应。
         *  这可以有效防止 AI 连续回复，显得更自然。
         */
        //refractoryPeriodMs: Computed<number>;
    };

    readonly system?: SystemConfig;
}

const WillingnessConfigSchema: Schema<WillingnessConfig> = Schema.object({
    base: Schema.object({
        text: Schema.computed<Schema<number>>(Schema.number().default(10)).default(10).description("收到普通文本消息的基础分"),
        //image: Schema.computed<Schema<number>>(Schema.number()).default(2).description("收到图片消息的基础分"),
        //emoji: Schema.computed<Schema<number>>(Schema.number()).default(1).description("收到表情的基础分"),
    }),
    attribute: Schema.object({
        atMention: Schema.computed<Schema<number>>(Schema.number().default(100)).default(100).description("被@时的额外加成"),
        isQuote: Schema.computed<Schema<number>>(Schema.number().default(15)).default(15).description("作为回复/引用时的额外加成"),
        isDirectMessage: Schema.computed<Schema<number>>(Schema.number().default(40)).default(40).description("在私聊场景下的额外加成"),
    }),
    interest: Schema.object({
        keywords: Schema.computed<Schema<string[]>>(Schema.array(Schema.string()).default([]))
            .role("table")
            .default([])
            .description("触发高兴趣的关键词"),
        keywordMultiplier: Schema.computed<Schema<number>>(Schema.number().default(1.2)).default(1.2).description("包含关键词时的乘数"),
        defaultMultiplier: Schema.computed<Schema<number>>(Schema.number().default(1)).default(1).description("默认乘数"),
    }),
    lifecycle: Schema.object({
        maxWillingness: Schema.computed<Schema<number>>(Schema.number().default(100)).min(10).default(100).description("意愿值的最大上限"),
        decayHalfLifeSeconds: Schema.computed<Schema<number>>(Schema.number().default(90))
            .min(5)
            .default(90)
            .description("意愿值衰减到一半所需的时间（秒）"),
        probabilityThreshold: Schema.computed<Schema<number>>(Schema.number().default(60))
            .min(0)
            .default(60)
            .description("将意愿值转换为回复概率的激活门槛"),
        probabilityAmplifier: Schema.computed<Schema<number>>(Schema.number().default(0.05))
            .min(0.01)
            .max(1)
            .default(0.05)
            .description("概率放大系数"),
        replyCost: Schema.computed<Schema<number>>(Schema.number().default(30))
            .min(0)
            .default(30)
            .description('决定回复后，扣除的"发言精力惩罚"'),
        // refractoryPeriodMs: Schema.computed<Schema<number>>(Schema.number())
        //     .min(0)
        //     .default(3000)
        //     .description("回复后的“不应期”（毫秒），防止AI连续发言"),
    }),
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
     * 一张图片在上下文中出现 N 次后将被视为"过期"，除非它被引用。
     */
    imageLifecycleCount: number;
    detail: "low" | "high" | "auto";
}

export const VisionConfigSchema: Schema<VisionConfig> = Schema.object({
    enabled: Schema.boolean().default(false).description("是否启用视觉功能"),
    allowedImageTypes: Schema.array(Schema.string()).default(["image/jpeg", "image/png"]).description("允许的图片类型"),
    maxImagesInContext: Schema.number().default(3).description("在上下文中允许包含的最大图片数量"),
    imageLifecycleCount: Schema.number().default(2).description("图片的上下文生命周期（出现次数）。超过此次数的图片将被忽略，除非被引用"),
    detail: Schema.union(["low", "high", "auto"]).default("low").description("图片细节程度"),
});

/**
 * 智能体行为总体配置
 */
export interface AgentBehaviorConfig {
    arousal: ArousalConfig;
    willingness: WillingnessConfig;
    streamAction: boolean;
    heartbeat: number;
    prompt: {
        systemTemplate: string;
        userTemplate: string;
        multiModalSystemTemplate: string;
    };
    vision: VisionConfig;
    readonly system?: SystemConfig;

    /**
     * 当处理消息过程中收到新消息时的处理策略
     * - skip: 跳过此消息（默认行为）
     * - immediate: 处理完当前消息后立即处理新消息
     * - deferred: 等待安静期后处理被跳过的话题
     */
    newMessageStrategy: "skip" | "immediate" | "deferred";

    /**
     * 延迟处理策略的安静期时间（毫秒）
     * 当一段时间内没有新消息时才处理被跳过的话题
     */
    deferredProcessingTime?: number;
}

export const AgentBehaviorConfigSchema: Schema<AgentBehaviorConfig> = Schema.object({
    arousal: ArousalConfigSchema.description("唤醒条件"),
    willingness: WillingnessConfigSchema.description("响应意愿"),
    streamAction: Schema.boolean().default(false).experimental(),
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
    vision: VisionConfigSchema.description("视觉与多模态配置"),
    newMessageStrategy: Schema.union([
        Schema.const("skip").description("跳过新消息（默认）"),
        Schema.const("immediate").description("立即处理新消息"),
        Schema.const("deferred").description("延迟处理被跳过话题"),
    ])
        .default("skip")
        .description("处理新消息的策略"),
    deferredProcessingTime: Schema.number()
        .default(10000) // 默认10秒
        .description("延迟处理策略的安静期时间（毫秒）"),
});
