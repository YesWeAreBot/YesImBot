import { readFileSync } from "fs";
import { Schema } from "koishi";
import path from "path";

import { SystemConfig } from "@/config";
import { PROMPTS_DIR } from "@/shared/constants";

// 默认的系统和用户模板文件路径
export const SystemBaseTemplate = readFileSync(path.resolve(PROMPTS_DIR, "memgpt_v2_chat.txt"), "utf-8");
export const UserBaseTemplate = readFileSync(path.resolve(PROMPTS_DIR, "user_base.txt"), "utf-8");
export const MultiModalSystemBaseTemplate = `Images that appear in the conversation will be provided first, numbered in the format 'Image #[ID]:'.
In the subsequent conversation text, placeholders in the format <image id="[ID]" onetime-code="{{ ONETIME_CODE }}"/> will be used to refer to these images.
Please participate in the conversation considering the full context of both images and text.`;

export type ChannelDescriptor = {
    platform: string;
    isDirect: boolean;
    id: string;
};

/** Agent 的唤醒条件配置 */
export interface ArousalConfig {
    /**
     * 允许 Agent 响应的频道。
     * 这是一个 "OR" 关系的列表，其中每个子列表是 "AND" 关系。
     * UI 建议: 提供一个可动态增减的列表，每个列表项里又能动态增减频道，会非常直观。
     */
    allowedChannels: ChannelDescriptor[];
    /** 消息防抖时间 (毫秒)，防止短时间内对相同模式的重复响应 */
    debounceMs: number;
}

export const ArousalConfigSchema: Schema<ArousalConfig> = Schema.object({
    allowedChannels: Schema.array(
        Schema.object({
            platform: Schema.string().required().description("平台"),
            isDirect: Schema.boolean().default(false).description("是否为私聊"),
            id: Schema.string().required().description("频道 ID"),
        })
    )
        .role("table")
        .default([{ platform: "onebot", isDirect: false, id: "*" }])
        .description("允许 Agent 响应的频道"),
    debounceMs: Schema.number().default(1000).description("消息防抖时间 (毫秒)"),
});

/** Agent 的响应意愿配置 (决定是否响应) */
export interface WillingnessConfig {
    /** 人格预设名称 */
    personality?: string;
    // --- A. 基础分数 (Base Scores) ---
    // 定义不同消息类型的"基础反应分"。它们通常是互斥的。
    base: {
        /** 收到普通文本消息的基础分。这是对话的基石。 */
        text: number;
        /** 收到图片消息的基础分。可以设为负数让AI不爱理睬图片。 */
        image: number;
        /** 收到表情/贴纸的基础分。通常较低。 */
        emoji: number;
    };

    // --- B. 属性加成 (Attribute Bonuses) ---
    // 如果消息满足以下属性，在基础分之上额外增加的分数。可以叠加。
    attribute: {
        /** 被 @ 提及时的额外加成。这是最高优先级的信号。 */
        atMention: number;
        /** 作为"回复/引用"出现时的额外加成。表示对话正在延续。 */
        isQuote: number;
        /** 在私聊场景下的额外加成。私聊通常期望更高的响应度。 */
        isDirectMessage: number;
    };

    // --- C. 兴趣度模型 (Interest Model) ---
    // 基于内容计算一个乘数，影响最终得分。
    interest: {
        /** 触发"高兴趣"的关键词列表。 */
        keywords: string[];
        /** 消息包含关键词时，应用此乘数。>1 表示增强，<1 表示削弱。 */
        keywordMultiplier: number;
        /** 默认乘数（当没有关键词匹配时）。设为1表示不影响。 */
        defaultMultiplier: number;
    };

    // --- D. 意愿转换与生命周期 (Lifecycle & Conversion) ---
    // 这部分与之前类似，但参数名更清晰。
    lifecycle: {
        /** 意愿值的最大上限。 */
        maxWillingness: number;
        /** 意愿值衰减到一半所需的时间（秒）。 */
        decayHalfLifeSeconds: number;
        /** 将意愿值转换为回复概率的"激活门槛"。 */
        probabilityThreshold: number;
        /** 超过门槛后，转换为概率时的放大系数。 */
        probabilityAmplifier: number;
        /** 决定回复后，扣除的"发言精力惩罚"。 */
        replyCost: number;
    };
    readonly system?: SystemConfig;
}

// 预设性格对象
export const PersonalityPresets: Record<string, Partial<WillingnessConfig & { name: string }>> = {
    default: {
        name: "默认",
        base: { text: 10, image: 2, emoji: 1 },
        attribute: { atMention: 100, isQuote: 15, isDirectMessage: 40 },
        interest: { keywords: [], keywordMultiplier: 1.2, defaultMultiplier: 1.0 },
        lifecycle: { maxWillingness: 100, decayHalfLifeSeconds: 90, probabilityThreshold: 60, probabilityAmplifier: 0.05, replyCost: 30 },
    },
    /**
     * 阳光开朗的"群聊显眼包" (Sunny & Outgoing)
     *   性格特点: 活泼、话多、喜欢参与任何话题、乐于分享、有点傻乐。对表情包和图片有积极反应。
     *   设计思路: 低回复门槛，低发言成本，对所有消息类型都有正面反馈。衰减慢，意味着它对一个话题的兴趣能持续很久。
     *   适用场景: 活跃的日常闲聊群、朋友群。
     */
    outgoing: {
        name: "开朗活泼",
        base: { text: 15, image: 10, emoji: 5 },
        attribute: { atMention: 100, isQuote: 15, isDirectMessage: 25 },
        interest: { keywords: ["哈哈", "好玩", "推荐", "电影", "游戏"], keywordMultiplier: 1.5, defaultMultiplier: 1.0 },
        lifecycle: { maxWillingness: 100, decayHalfLifeSeconds: 180, probabilityThreshold: 35, probabilityAmplifier: 0.08, replyCost: 20 },
    },
    /**
     * 高冷严谨的"领域专家" (Cold & Professional)
     *   性格特点: 平时不说话，惜字如金。只对自己专业领域（关键词）或被直接提问时才回应，且回应精准、深入。对闲聊和表情包感到厌烦。
     *   设计思路: 高回复门槛，高发言成本。对无关信息（文本、图片、表情）设置低分甚至负分。
     *           关键词乘数和@加成极高，是其主要激活方式。衰减快，不相干的话题很快就从它"脑中"消失。
     *   适用场景: 技术问答群、学习小组、工作对接群。
     */
    professional: {
        name: "高冷严谨",
        base: { text: 2, image: -10, emoji: -5 },
        attribute: { atMention: 100, isQuote: 20, isDirectMessage: 60 },
        interest: { keywords: ["API", "BUG", "部署", "算法", "模型"], keywordMultiplier: 5.0, defaultMultiplier: 1.0 },
        lifecycle: { maxWillingness: 100, decayHalfLifeSeconds: 45, probabilityThreshold: 75, probabilityAmplifier: 0.1, replyCost: 60 },
    },
    /**
     * 温柔体贴的"知心姐姐" (Gentle & Caring)
     *   性格特点: 不会主动挑起话题，但当群里有人表达情绪（尤其是负面情绪）或需要帮助时，会第一时间出现。发言温柔，喜欢用表情符号。
     *   设计思路: 基础分不高，但对特定"情绪"关键词（如"难过"、"怎么办"）有极高乘数。
     *           回复门槛适中，但发言成本低，可以进行多轮安慰。私聊加成高，鼓励用户向其倾诉。
     *   适用场景: 情感支持、心理咨询（辅助）、用户关怀社群。
     */
    caring: {
        name: "温柔体贴",
        base: { text: 8, image: 3, emoji: 4 },
        attribute: { atMention: 100, isQuote: 10, isDirectMessage: 50 },
        interest: { keywords: ["难过", "伤心", "怎么办", "求助", "谢谢你", "太好了"], keywordMultiplier: 4.0, defaultMultiplier: 1.0 },
        lifecycle: { maxWillingness: 100, decayHalfLifeSeconds: 120, probabilityThreshold: 45, probabilityAmplifier: 0.07, replyCost: 15 },
    },
};

// 定义一个基础的可编辑的 Schema，用于"自定义"模式
const EditableWillingnessSchema = Schema.object({
    base: Schema.object({
        text: Schema.number().default(10).description("收到普通文本消息的基础分"),
        image: Schema.number().default(2).description("收到图片消息的基础分"),
        emoji: Schema.number().default(1).description("收到表情的基础分"),
    }),
    attribute: Schema.object({
        atMention: Schema.number().default(100).description("被@时的额外加成"),
        isQuote: Schema.number().default(15).description("作为回复/引用时的额外加成"),
        isDirectMessage: Schema.number().default(40).description("在私聊场景下的额外加成"),
    }),
    interest: Schema.object({
        keywords: Schema.array(Schema.string()).role("table").description("触发高兴趣的关键词"),
        keywordMultiplier: Schema.number().default(1.2).description("包含关键词时的乘数"),
        defaultMultiplier: Schema.number().default(1).description("默认乘数"),
    }),
    lifecycle: Schema.object({
        maxWillingness: Schema.number().default(100).min(10).description("意愿值的最大上限"),
        decayHalfLifeSeconds: Schema.number().default(90).min(5).description("意愿值衰减到一半所需的时间（秒）"),
        probabilityThreshold: Schema.number().min(0).default(60).description("将意愿值转换为回复概率的激活门槛"),
        probabilityAmplifier: Schema.number().default(0.05).min(0.01).max(1).description("概率放大系数"),
        replyCost: Schema.number().min(0).default(30).description('决定回复后，扣除的"发言精力惩罚"'),
    }),
});

// 将预设和"自定义"选项整合起来
const personalityOptions = Object.keys(PersonalityPresets);
const customOption = "custom";

const WillingnessForm: Schema<WillingnessConfig> = Schema.intersect([
    Schema.object({
        personality: Schema.union([
            ...personalityOptions.map((presetName) => {
                const preset = PersonalityPresets[presetName];
                return Schema.const(presetName).description(preset.name);
            }),
            Schema.const(customOption).description("自定义"),
        ])
            .default("default")
            .description('选择发言行为预设。选择"自定义"以手动调整下方所有参数。此参数只影响发言频率。'),
    }),
    Schema.union([
        ...personalityOptions.map((presetName) => {
            const preset = PersonalityPresets[presetName];
            return Schema.object({
                personality: Schema.const(presetName).required().description(preset.name),
                ...Schema.const(preset).dict,
            });
        }),
        Schema.object({
            personality: Schema.const(customOption).required().description("自定义"),
            ...EditableWillingnessSchema.dict,
        }).description("响应意愿"),
        Schema.object({}),
    ]),
]) as unknown as Schema<WillingnessConfig>;

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
    maxImagesInContext: Schema.number().default(3).description("在上下文中允许包含的最大图片数量。"),
    imageLifecycleCount: Schema.number().default(2).description("图片的上下文生命周期（出现次数）。超过此次数的图片将被忽略，除非被引用。"),
    detail: Schema.union(["low", "high", "auto"]).default("low").description("图片细节程度"),
});

/**
 * 智能体行为总体配置
 */
export interface AgentBehaviorConfig {
    arousal: ArousalConfig;
    willingness: WillingnessConfig;
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
    willingness: WillingnessForm,
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
