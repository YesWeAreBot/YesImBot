import { readFileSync } from "fs";
import { Computed, Schema } from "koishi";
import path from "path";

import type { TopicConfig } from "./topics";

import { SystemConfig } from "@/config";
import { PROMPTS_DIR } from "@/shared/constants";

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
    /** 允许 Agent 响应的频道 */
    allowedChannels: ChannelDescriptor[];
    /** 消息防抖时间 (毫秒)，防止短时间内对相同模式的重复响应 */
    debounceMs: number;
    prioritizeMentions?: boolean;
}

export const ArousalConfigSchema: Schema<ArousalConfig> = Schema.object({
    allowedChannels: Schema.array(
        Schema.object({
            platform: Schema.string().required().description("平台"),
            type: Schema.union([Schema.const("private").description("私聊"), Schema.const("guild").description("群组")])
                .default("guild")
                .description("频道类型"),
            id: Schema.string().required().description("频道或用户 ID"),
        }).description("响应频道")
    )
        .default([{ platform: "onebot", type: "guild", id: "*" }])
        .description("允许 Agent 响应的频道。使用 * 作为通配符"),
    prioritizeMentions: Schema.boolean()
        .default(false)
        .description("明确 @ 机器人时直接触发回复判断后的调度，沿用处理新消息策略；当前会话存在回复抑制规则时不生效"),
    debounceMs: Schema.number().default(1000).description("消息防抖时间 (毫秒)"),
});

export interface TypeSafeConfig {
    mode: "off" | "observe" | "adjust";
    evaluationModel: { providerName: string; modelId: string };
    timeoutMs: number;
    historyLimit: number;
    interests: string;
    influence: number;
}

export interface WillingnessConfig {
    topics?: TopicConfig;
    participation?: {
        enabled: boolean;
        durationSeconds: number;
        influence: number;
    };
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

    readonly system?: SystemConfig;
}

const WillingnessConfigSchema: Schema<WillingnessConfig> = Schema.object({
    topics: Schema.object({
        enabled: Schema.boolean()
            .default(false)
            .experimental()
            .description("启用实验性话题意愿，默认关闭；识别可能滞后或不准确，请按实际聊天效果调整"),
        model: Schema.dynamic("modelService.selectableModels").description("话题总结模型（需具备对话能力；启用后会发送近期聊天内容）"),
        minIntervalMs: Schema.number().min(1000).max(3600000).default(30000).description("两次话题分析的最短间隔（毫秒）"),
        messagesPerAnalysis: Schema.natural().min(1).max(100).default(6).description("再次分析前至少收到的新消息数"),
        historyLimit: Schema.natural().min(1).max(30).default(20).description("分析时参考的近期消息数"),
        timeoutMs: Schema.number().min(100).max(30000).default(5000).description("话题分析超时（毫秒），失败后沿用普通意愿"),
        maxTopics: Schema.natural().min(1).max(8).default(4).description("每个会话最多保留的话题数"),
        idleTimeoutSeconds: Schema.number().min(10).max(86400).default(600).description("无新消息多久后清除话题状态（秒）"),
        influence: Schema.number().min(0).max(1).default(0.5).description("话题兴趣对本条消息意愿增益的影响强度"),
        latestTopicPreference: Schema.number()
            .min(0)
            .max(100)
            .step(1)
            .role("slider")
            .default(70)
            .description("当前话题偏好（%）：80 表示 80% 当前话题偏好 + 20% 话题占比，再结合各话题意愿选择回复重点"),
    })
        .collapse()
        .experimental()
        .description("话题意愿（实验性；兴趣沿用 TypeSafe 角色兴趣，留空使用兴趣关键词）"),
    participation: Schema.object({
        enabled: Schema.boolean().default(false).description("成功回复后短暂保持对话参与，默认关闭"),
        durationSeconds: Schema.number().min(1).max(86400).default(60).description("参与保持的持续时间（秒，最多一天），仅成功回复会刷新"),
        influence: Schema.number().min(0).max(1).default(0.5).description("参与保持对本条消息意愿增益的影响强度"),
    })
        .collapse()
        .description("对话参与保持（不强制回复，沿用回复控制规则）"),
    typesafe: Schema.object({
        mode: Schema.union(["off", "observe", "adjust"]).default("off").description("TypeSafe 接话判断：关闭 / 仅记录 / 调整意愿"),
        evaluationModel:
            Schema.dynamic("modelService.evaluationModels").description("判断模型，请在模型服务中配置 TypeSafe 提供商和评估能力"),
        timeoutMs: Schema.number().min(100).max(30000).default(3000).description("判断超时（毫秒），失败后沿用原意愿"),
        historyLimit: Schema.natural().max(30).default(8).description("判断时参考的近期消息数"),
        interests: Schema.string().role("textarea").default("").description("角色兴趣，留空使用高兴趣关键词"),
        influence: Schema.number().min(0).max(1).default(0.5).description("本条消息意愿增益的调整强度"),
    })
        .collapse()
        .description("TypeSafe 接话判断（启用后将近期对话发送给所选提供商）"),
    base: Schema.object({
        text: Schema.computed<Schema<number>>(Schema.number().default(12))
            .default(12)
            .description("收到普通文本消息的基础分<br/>这部分参数都可以通过 `添加分支` 进行更加精细化的配置"),
    })
        .collapse()
        .description("基础意愿"),
    attribute: Schema.object({
        atMention: Schema.computed<Schema<number>>(Schema.number().default(100)).default(100).description("被@时的额外加成"),
        isQuote: Schema.computed<Schema<number>>(Schema.number().default(15)).default(15).description("作为回复/引用时的额外加成"),
        isDirectMessage: Schema.computed<Schema<number>>(Schema.number().default(40)).default(40).description("在私聊场景下的额外加成"),
    })
        .collapse()
        .description("消息属性加成"),
    interest: Schema.object({
        keywords: Schema.computed<Schema<string[]>>(Schema.array(Schema.string()).role("table").default([]))
            .default([])
            .description("触发高兴趣的关键词"),
        keywordMultiplier: Schema.computed<Schema<number>>(Schema.number().default(1.2)).default(1.2).description("包含关键词时的乘数"),
        defaultMultiplier: Schema.computed<Schema<number>>(Schema.number().default(1)).default(1).description("默认乘数"),
    })
        .collapse()
        .description("兴趣关键词与乘数"),
    lifecycle: Schema.object({
        maxWillingness: Schema.computed<Schema<number>>(Schema.number().min(10).default(100)).default(100).description("意愿值的最大上限"),
        decayHalfLifeSeconds: Schema.computed<Schema<number>>(Schema.number().min(5).default(600))
            .default(600)
            .description("意愿值衰减到一半所需的时间（秒）"),
        probabilityThreshold: Schema.computed<Schema<number>>(Schema.number().min(0).default(55))
            .default(55)
            .description("将意愿值转换为回复概率的激活门槛"),
        probabilityAmplifier: Schema.computed<Schema<number>>(Schema.number().min(0.01).max(1).default(0.04))
            .default(0.04)
            .description("概率放大系数"),
        replyCost: Schema.computed<Schema<number>>(Schema.number().min(0).default(35))
            .default(35)
            .description('决定回复后，扣除的"发言精力惩罚"'),
        // refractoryPeriodMs: Schema.computed<Schema<number>>(Schema.number())
        //     .min(0)
        //     .default(3000)
        //     .description("回复后的“不应期”（毫秒），防止AI连续发言"),
    })
        .collapse()
        .description("意愿衰减与回复概率"),
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

export const VisionConfigSchema: Schema<VisionConfig> = Schema.object({
    enableVision: Schema.boolean().default(false).description("是否启用视觉功能"),
    allowedImageTypes: Schema.array(Schema.string()).default(["image/jpeg", "image/png"]).description("允许的图片类型"),
    maxImagesInContext: Schema.number().default(3).description("在上下文中允许包含的最大图片数量"),
    imageLifecycleCount: Schema.number().default(2).description("图片的上下文生命周期（出现次数）。超过此次数的图片将被忽略，除非被引用"),
    detail: Schema.union(["low", "high", "auto"]).default("low").description("图片细节程度"),
});

export type AgentBehaviorConfig = ArousalConfig &
    WillingnessConfig &
    VisionConfig & {
        systemTemplate: string;
        userTemplate: string;
        multiModalSystemTemplate: string;
    } & {
        replySuppression?: { defaultDurationSeconds: number };
        decisionRecording?: { enabled: boolean; directory: string; maxEntries: number; maxBytes: number; retentionHours: number };
        streamAction: boolean;
        nativeToolCalling?: boolean;
        heartbeat: number;

        newMessageStrategy: "skip" | "immediate" | "deferred";
        deferredProcessingTime?: number;
    };

export const AgentBehaviorConfigSchema: Schema<AgentBehaviorConfig> = Schema.intersect([
    ArousalConfigSchema.description("唤醒条件"),
    Schema.object({
        nativeToolCalling: Schema.boolean().default(false).description("使用模型原生工具调用（需模型支持），关闭时沿用 JSON 动作"),
        streamAction: Schema.boolean().default(false).experimental().description("实验性流式动作处理"),
        heartbeat: Schema.number().min(1).max(10).default(5).role("slider").step(1).description("每轮对话最大心跳次数"),
        newMessageStrategy: Schema.union([
            Schema.const("skip").description("跳过新消息（默认）"),
            Schema.const("immediate").description("立即处理新消息"),
            Schema.const("deferred").description("延迟处理被跳过话题"),
        ])
            .default("skip")
            .description("处理新消息的策略"),
        deferredProcessingTime: Schema.number().default(10000).description("延迟处理策略的安静期时间（毫秒），仅 deferred 策略使用"),
    })
        .collapse()
        .description("执行策略"),
    WillingnessConfigSchema.description("响应意愿"),
    VisionConfigSchema.collapse().description("视觉与图片上下文"),
    Schema.object({
        replySuppression: Schema.object({
            defaultDurationSeconds: Schema.number().min(1).default(60).description("回复暂停命令的默认时长（秒），命令参数仅覆盖本次操作"),
        }).description("回复暂停"),
        decisionRecording: Schema.object({
            enabled: Schema.boolean().default(false).description("保存本地决策记录以供离线回放，默认关闭"),
            directory: Schema.string().default("data/yesimbot/decisions").description("记录目录，相对 Koishi 工作目录，也可使用绝对路径"),
            maxEntries: Schema.natural().min(1).max(100000).default(10000).description("最多保留的决策快照条数"),
            maxBytes: Schema.natural().min(1024).max(104857600).default(10485760).description("记录容量上限（字节），默认 10 MiB"),
            retentionHours: Schema.number().min(1).max(720).default(72).description("记录保留时长（小时）"),
        }).description("决策记录与回放"),
    })
        .collapse()
        .description("回复控制与决策记录"),
    Schema.object({
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
    })
        .collapse()
        .description("提示词模板"),
]);
