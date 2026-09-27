/* eslint-disable ts/no-redeclare */
import type { Computed } from "koishi";
import { Schema } from "koishi";

export interface ChannelDescriptor {
    platform: string;
    type: "private" | "guild";
    id: string;
}

/** Agent 的唤醒条件配置 */
export interface ArousalConfig {
    /** 允许 Agent 响应的频道 */
    allowedChannels: ChannelDescriptor[];
    /** 消息防抖时间 (毫秒)，防止短时间内对相同模式的重复响应 */
    debounceMs: number;
    newMessageStrategy: "skip" | "immediate" | "deferred";
    deferredProcessingTime?: number;
}

export const ArousalConfig: Schema<ArousalConfig> = Schema.object({
    allowedChannels: Schema.array(
        Schema.object({
            platform: Schema.string().required().description("平台"),
            type: Schema.union([Schema.const("private").description("私聊"), Schema.const("guild").description("群组")])
                .default("guild")
                .description("频道类型"),
            id: Schema.string().required().description("频道或用户 ID"),
        }),
    )
        .role("table")
        .default([{ platform: "onebot", type: "guild", id: "*" }])
        .description("允许 Agent 响应的频道。使用 * 作为通配符"),
    debounceMs: Schema.number().default(1000).description("消息防抖时间 (毫秒)"),
    newMessageStrategy: Schema.union([
        Schema.const("skip").description("跳过"),
        Schema.const("immediate").description("当前回复结束后处理"),
        Schema.const("deferred").description("当前回复结束并等待安静期后处理"),
    ]).default("skip").description("回复期间新消息的处理策略；强制回复的 @ 和私聊消息仍优先排队"),
    deferredProcessingTime: Schema.number().min(0).default(10000).description("延迟处理策略的安静期时间（毫秒）"),
});

export interface WillingnessConfig {
    typesafe?: TypeSafeConfig;
    base: {
        /** 收到普通文本消息的基础分。这是对话的基石 */
        text: Computed<number>;
    };

    // 如果消息满足以下属性，在基础分之上额外增加的分数。可以叠加。
    attribute: {
        /** 被 @ 提及时的额外加成。这是最高优先级的信号 */
        atMention: Computed<number>;
        /** 作为"回复/引用"出现时的额外加成。表示对话正在延续 */
        isQuote: Computed<number>;
        /** 在私聊场景下的额外加成。私聊通常期望更高的响应度 */
        isDirectMessage: Computed<number>;
        /** 被 @ 时是否强制触发回复，不受概率阈值限制 */
        mentionForce: Computed<boolean>;
        /** 私聊消息是否强制触发回复，不受概率阈值限制 */
        directForce: Computed<boolean>;
    };

    // 基于内容计算一个乘数，影响最终得分。
    interest: {
        /** 触发"高兴趣"的关键词列表 */
        keywords: Computed<string[]>;
        /** 消息包含关键词时，应用此乘数。>1 表示增强，<1 表示削弱 */
        keywordMultiplier: Computed<number>;
        /** 默认乘数（当没有关键词匹配时）。设为1表示不影响 */
        defaultMultiplier: Computed<number>;
    };

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
    };
}

export interface TypeSafeConfig {
    mode: "off" | "observe" | "active";
    evaluationModel?: string;
    apiKey: string;
    baseURL: string;
    model: string;
    timeoutMs: number;
    historyLimit: number;
    interests: string;
    influence: number;
}

const WillingnessConfig: Schema<WillingnessConfig> = Schema.object({
    typesafe: Schema.object({
        mode: Schema.union([
            Schema.const("off").description("关闭"),
            Schema.const("observe").description("仅记录判断"),
            Schema.const("active").description("参与意愿计算"),
        ]).default("off").description("启用后将近期对话发送给 TypeSafe，辅助判断接话时机。仅记录模式不影响发言。"),
        evaluationModel: Schema.dynamic("registry.evaluationModels").default("").description("判断模型（Provider > 模型）；留空使用下方旧版直连配置"),
        apiKey: Schema.string().role("secret").default("").description("TypeSafe API 密钥"),
        baseURL: Schema.string().default("https://api.typesafe.ai/v1").description("TypeSafe API 地址，包含 /v1"),
        model: Schema.string().default("jev-1.13.0").description("判断模型"),
        timeoutMs: Schema.number().min(100).max(30000).default(3000).description("判断超时（毫秒），超时后沿用原意愿计算"),
        historyLimit: Schema.natural().max(30).default(8).description("判断时参考的近期消息数，0 表示只看当前消息"),
        interests: Schema.string().role("textarea").default("").description("角色感兴趣的话题，留空时使用已有的高兴趣关键词"),
        influence: Schema.number().min(0).max(1).step(0.05).default(0.5).description("对本条消息意愿增益的影响强度；0 为不调整，0.5 时增益最多减半或增加一半"),
    }).description("TypeSafe 接话判断"),
    base: Schema.object({
        text: Schema.computed<Schema<number>>(Schema.number().default(12))
            .default(12)
            .description("收到普通文本消息的基础分<br/>这部分参数都可以通过 `添加分支` 进行更加精细化的配置"),
    }),
    attribute: Schema.object({
        atMention: Schema.computed<Schema<number>>(Schema.number().default(100)).default(100).description("被@时的额外加成"),
        isQuote: Schema.computed<Schema<number>>(Schema.number().default(15)).default(15).description("作为回复/引用时的额外加成"),
        isDirectMessage: Schema.computed<Schema<number>>(Schema.number().default(40)).default(40).description("在私聊场景下的额外加成"),
        mentionForce: Schema.computed<Schema<boolean>>(Schema.boolean().default(true)).default(true).description("被 @ 时强制触发回复"),
        directForce: Schema.computed<Schema<boolean>>(Schema.boolean().default(true)).default(true).description("私聊消息强制触发回复"),
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
        decayHalfLifeSeconds: Schema.computed<Schema<number>>(Schema.number().default(600))
            .min(5)
            .default(600)
            .description("意愿值衰减到一半所需的时间（秒）"),
        probabilityThreshold: Schema.computed<Schema<number>>(Schema.number().default(55))
            .min(0)
            .default(55)
            .description("将意愿值转换为回复概率的激活门槛"),
        probabilityAmplifier: Schema.computed<Schema<number>>(Schema.number().default(0.04))
            .min(0.01)
            .max(1)
            .default(0.04)
            .description("概率放大系数"),
        replyCost: Schema.computed<Schema<number>>(Schema.number().default(35))
            .min(0)
            .default(35)
            .description("决定回复后，扣除的\"发言精力惩罚\""),
    }),
});

/** 视觉与多模态相关配置 */
export interface VisionConfig {
    /** 是否启用视觉功能 */
    enableVision: boolean;
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

export const VisionConfig: Schema<VisionConfig> = Schema.object({
    enableVision: Schema.boolean().default(false).description("是否启用视觉功能"),
    allowedImageTypes: Schema.array(Schema.string()).default(["image/jpeg", "image/png"]).description("允许的图片类型"),
    maxImagesInContext: Schema.number().default(3).description("在上下文中允许包含的最大图片数量"),
    imageLifecycleCount: Schema.number().default(2).description("图片的上下文生命周期（出现次数）。超过此次数的图片将被忽略，除非被引用"),
    detail: Schema.union(["low", "high", "auto"]).default("low").description("图片细节程度"),
});

export type AgentBehaviorConfig = ArousalConfig
    & WillingnessConfig
    & VisionConfig & {
        streamAction: boolean;
        heartbeat: number;
    };

export const AgentBehaviorConfig: Schema<AgentBehaviorConfig> = Schema.intersect([
    ArousalConfig.description("唤醒条件"),
    WillingnessConfig.description("响应意愿"),
    VisionConfig.description("视觉配置"),
    Schema.object({
        streamAction: Schema.boolean().default(false).experimental(),
        heartbeat: Schema.number().min(1).max(10).default(5).role("slider").step(1).description("每轮对话最大心跳次数"),
    }),
]);
