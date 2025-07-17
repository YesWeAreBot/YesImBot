import { Context, Logger, Session } from "koishi";
import { PersonalityPresets, WillingnessConfig } from "./config";
import { Services } from "@/services/types";

export interface MessageContext {
    chatId: string;
    content: string; // 消息的纯文本内容

    // 基础类型 (通常互斥)
    isImage: boolean;
    isEmoji: boolean;

    // 附加属性 (可叠加)
    isMentioned: boolean;
    isQuote: boolean;
    isDirect: boolean;
}

export class WillingnessManager {
    private readonly ctx: Context;
    private readonly config: WillingnessConfig;
    /** 意愿值的存储结构。Key: 聊天ID，Value: 意愿值 */
    private willingnessScores: Map<string, number> = new Map();
    /** 上次回复的时间戳 */
    private lastReplyTimestamps: Map<string, number> = new Map();
    /** 衰减定时器 */
    private decayInterval: NodeJS.Timeout | null = null;
    private logger: Logger;
    private decayFactor: number;

    constructor(ctx: Context, config: WillingnessConfig) {
        this.ctx = ctx;

        /* prettier-ignore */
        //@ts-ignore
        if (config.personality && PersonalityPresets[config.personality]) config = PersonalityPresets[config.personality];

        this.config = config;
        // 根据半衰期公式: factor^T = 0.5  =>  factor = 0.5^(1/T)
        this.decayFactor = Math.pow(0.5, 1 / this.config.lifecycle.decayHalfLifeSeconds);
        this.logger = ctx[Services.Logger].getLogger("[意愿管理器]");
    }

    /**
     * 启动意愿值的周期性衰减。应在应用启动时调用一次。
     */
    public startDecayCycle(): void {
        if (this.decayInterval) {
            return; // 防止重复启动
        }
        this.decayInterval = setInterval(() => {
            this._decay();
        }, 1000);
    }

    /**
     * 停止衰减周期。
     */
    public stopDecayCycle(): void {
        if (this.decayInterval) {
            clearInterval(this.decayInterval);
            this.decayInterval = null;
        }
    }

    /**
     * 私有方法：执行一次衰减。
     */
    private _decay(): void {
        const baseFactor = this.decayFactor;

        for (const chatId of this.willingnessScores.keys()) {
            const currentScore = this.willingnessScores.get(chatId) || 0;

            // --- 弹性衰减逻辑 ---
            let effectiveFactor = baseFactor;
            // 如果意愿值很高（例如超过了回复门槛），说明AI正在“关注”这个对话，衰减应该变慢
            if (currentScore > this.config.lifecycle.probabilityThreshold) {
                // 让衰减因子更接近1，从而衰减得更慢
                // (1.0 - baseFactor) 是衰减的“强度”，我们将其减半
                effectiveFactor = 1.0 - (1.0 - baseFactor) * 0.5;
            }

            const newScore = currentScore * effectiveFactor;
            // -------------------------

            this.willingnessScores.set(chatId, newScore < 0.01 ? 0 : newScore);
        }
    }

    /**
     * 核心计算方法：根据上下文计算意愿增益
     * @param context 消息上下文
     * @returns 本次消息产生的意愿增益值
     */
    private calculateGain(context: MessageContext): number {
        const { base, attribute, interest } = this.config;

        // 1. 确定基础分
        let score = 0;

        if (context.isImage) score = base.image;
        else if (context.isEmoji) score = base.emoji;
        else score = base.text; // 默认是文本消息

        // 2. 叠加属性加成
        if (context.isMentioned) score += attribute.atMention;
        if (context.isQuote) score += attribute.isQuote;
        if (context.isDirect) score += attribute.isDirectMessage;

        // 3. 应用兴趣度乘数
        const hasKeyword = interest.keywords.some((kw) => context.content.includes(kw));
        const multiplier = hasKeyword ? interest.keywordMultiplier : interest.defaultMultiplier;

        return score * multiplier;
    }

    /**
     * 公开接口：更新意愿值并返回回复概率
     * @param context 消息上下文
     * @returns 回复概率 (0-1)
     */
    public calculateReplyProbability(context: MessageContext): number {
        const { chatId } = context;
        const { lifecycle } = this.config;

        const gain = this.calculateGain(context);
        let currentWillingness = this.willingnessScores.get(chatId) || 0;

        // --- 非线性增益 ---
        const gainMultiplier = getDynamicGainMultiplier(currentWillingness, lifecycle.maxWillingness);
        const effectiveGain = gain * gainMultiplier;

        currentWillingness += effectiveGain;
        // -------------------------

        currentWillingness = Math.min(currentWillingness, lifecycle.maxWillingness);
        this.willingnessScores.set(chatId, currentWillingness);

        // 转换为概率
        if (currentWillingness <= lifecycle.probabilityThreshold) {
            return 0;
        }
        const probability = (currentWillingness - lifecycle.probabilityThreshold) * lifecycle.probabilityAmplifier;

        return Math.max(0, Math.min(1, probability));
    }

    /**
     * 回复前处理：扣除发言成本
     * @param chatId 聊天ID
     */
    public handlePreReply(chatId: string): void {
        const { lifecycle } = this.config;
        const currentWillingness = this.willingnessScores.get(chatId) || 0;
        const newWillingness = Math.max(0, currentWillingness - lifecycle.replyCost);
        this.willingnessScores.set(chatId, newWillingness);
    }

    /**
     * 在成功回复后执行。重置或降低意愿，进入“冷却期”。
     * @param chatId 聊天ID
     * @param replyContent 回复内容的长度，可以用来决定惩罚力度
     */
    public handlePostReply(chatId: string, replyContentLength: number = 0): void {
        const { replyCost, maxWillingness } = this.config.lifecycle;

        // 策略1：直接大幅降低意愿值
        // 这种做法模拟了“我说完这个话题了”
        let currentWillingness = this.willingnessScores.get(chatId) || 0;
        currentWillingness -= replyCost; // 基础成本
        this.willingnessScores.set(chatId, Math.max(0, currentWillingness));

        // 策略2：更狠一点，直接清零或设置为一个很低的基础值
        // 这种做法可以有效防止AI在一次回复后，因为意愿值依然很高而立即对下一条消息做出反应，从而避免“连麦”
        //this.willingnessScores.set(chatId, 0); // 直接清零，等待新刺激
        //this.logger.debug(`[${chatId}] 回复成功，意愿值已重置。`);

        // 策略3：动态成本（高级）
        // 回复得越长，消耗的“精力”越多
        // const dynamicCost = replyCost + (replyContentLength / 50); // 每50个字额外增加1点成本
        // let currentWillingness = this.willingnessScores.get(chatId) || 0;
        // this.willingnessScores.set(chatId, Math.max(0, currentWillingness - dynamicCost));
    }

    /**
     * 获取指定聊天的当前意愿值（用于调试和监控）。
     * @param chatId 聊天ID
     */
    public getCurrentWillingness(chatId: string): number {
        return this.willingnessScores.get(chatId) || 0;
    }

    /**
     * 核心决策方法：判断是否应该回复。
     * @param context 消息上下文
     * @returns 一个包含决策结果和概率的对象
     */
    public shouldReply(session: Session): { decision: boolean; probability: number } {
        const context: MessageContext = {
            chatId: session.cid,
            content: session.content,
            isImage: session.elements.some((e) => e.type === "image"),
            isEmoji: session.elements.some((e) => e.type === "face"),
            isMentioned:
                session.stripped.atSelf ||
                session.elements.some((e) => e.type === "at" && e.attrs.id === session.bot.selfId),
            isQuote: session.quote && session.quote?.user.id === session.bot.selfId,
            isDirect: session.isDirect,
        };

        const probability = this.calculateReplyProbability(context);

        const decision = Math.random() < probability;

        return { decision, probability };
    }
}

/**
 * S型曲线增益
 * @param current
 * @param max
 * @returns
 */
function getDynamicGainMultiplier(current: number, max: number): number {
    const ratio = current / max;

    // 定义S型曲线的几个关键点
    const activationPoint = 0.2; // A点：低于此值为启动区
    const saturationPoint = 0.8; // B点：高于此值为饱和区

    if (ratio < activationPoint) {
        // --- 启动区 ---
        // 线性增益或轻微负反馈
        return 1.0;
    } else if (ratio >= activationPoint && ratio < saturationPoint) {
        // --- 陡增区 (正反馈) ---
        // 可以设计一个放大函数，例如一个二次函数，在中间点达到峰值
        // 这是一个示例，你可以调整曲线形状
        const midpoint = (saturationPoint + activationPoint) / 2;
        const peakMultiplier = 2.0; // 峰值放大倍数
        // 简单的抛物线，开口向下
        const curve = -Math.pow((ratio - midpoint) * 2, 2) + peakMultiplier;
        return Math.max(1.0, curve); // 保证至少是1倍
    } else {
        // --- 饱和区 (负反馈) ---
        // 增益迅速下降
        // 使用你之前的负反馈模型，但更陡峭
        return 1 - (ratio - saturationPoint) / (1 - saturationPoint);
    }
}
