import type { ReplyCategory } from "./reply-control";
import { Services } from "@/shared/constants";
import { Context, Eval, Logger, Session, merge } from "koishi";
import { WillingnessConfig } from "./config";
import { Config } from "@/config";
import type { WillingnessCalculation } from "./decision-record";

export interface MessageContext {
    chatId: string;
    participationId?: string;
    content: string;
    //isImage: boolean;
    //isEmoji: boolean;
    isMentioned: boolean;
    isQuote: boolean;
    isDirect: boolean;
    allowedCategories?: ReplyCategory[];
}

export interface TopicWillingnessInput {
    latestTopicPreference?: number;
    currentScoreKey: string;
    multiplier: number;
    candidates: { scoreKey: string; share: number }[];
}

type ResolveComputed<T> =
    // 如果是函数
    T extends (session: Session) => infer R
        ? ResolveComputed<R>
        : // 如果是 Eval.Expr
          T extends Eval.Expr<infer U, boolean>
          ? ResolveComputed<U>
          : // 如果是数组
            T extends Array<infer V>
            ? ResolveComputed<V>[]
            : // 如果是对象（排除 null）
              T extends object
              ? { [K in keyof T]: ResolveComputed<T[K]> }
              : // 基本类型
                T;

// 从 WillingnessConfig 中解析出所有 Computed 后的纯净类型
type ResolvedWillingnessConfig = ResolveComputed<WillingnessConfig>;

/**
 * 决策结果
 */
export interface ReplyDecision {
    decision: boolean;
    probability: number;
    reason: "probability_roll" | "refractory_period" | "forced_reply_by_mention" | "below_threshold";
}

export interface ParticipationSnapshot {
    active: boolean;
    lastReplyAt: number | null;
    expiresAt: number | null;
    participantId: string | null;
}

export class WillingnessManager {
    private readonly ctx: Context;
    private readonly baseConfig: Config;
    private logger: Logger;

    // --- 状态存储 ---
    private willingnessScores: Map<string, number> = new Map();
    private lastMessageTimestamps: Map<string, number> = new Map(); // 记录每个对话的最后消息时间，用于计算热度
    private sessions = new Map<string, Session>();
    private participation = new Map<string, Omit<ParticipationSnapshot, "active">>();

    private decayInterval: NodeJS.Timeout | null = null;

    constructor(ctx: Context, config: Config) {
        this.ctx = ctx;
        this.baseConfig = config;
        this.logger = ctx[Services.Logger].getLogger("[意愿管理器]");

        ctx.on("dispose", () => {
            this.stopDecayCycle();
        });
    }

    /**
     * 获取并缓存解析后的配置
     */
    private _getResolvedConfig(session: Session): ResolvedWillingnessConfig {
        const config = this.baseConfig;

        // 解析所有 Computed 字段
        const resolved: Omit<ResolvedWillingnessConfig, "system"> = {
            base: {
                text: session.resolve(config.base.text),
                //image: session.resolve(config.base.image),
                //emoji: session.resolve(config.base.emoji),
            },
            attribute: {
                atMention: session.resolve(config.attribute.atMention),
                isQuote: session.resolve(config.attribute.isQuote),
                isDirectMessage: session.resolve(config.attribute.isDirectMessage),
            },
            interest: {
                keywords: session.resolve(config.interest.keywords),
                keywordMultiplier: session.resolve(config.interest.keywordMultiplier),
                defaultMultiplier: session.resolve(config.interest.defaultMultiplier),
            },
            lifecycle: {
                maxWillingness: session.resolve(config.lifecycle.maxWillingness),
                decayHalfLifeSeconds: session.resolve(config.lifecycle.decayHalfLifeSeconds),
                probabilityThreshold: session.resolve(config.lifecycle.probabilityThreshold),
                probabilityAmplifier: session.resolve(config.lifecycle.probabilityAmplifier),
                replyCost: session.resolve(config.lifecycle.replyCost),
                //refractoryPeriodMs: session.resolve(config.lifecycle.refractoryPeriodMs),
            },
        };

        return resolved;
    }

    public startDecayCycle(): void {
        if (this.decayInterval) return;
        this.decayInterval = setInterval(() => this._decay(), 1000);
    }

    public stopDecayCycle(): void {
        if (this.decayInterval) {
            clearInterval(this.decayInterval);
            this.decayInterval = null;
        }
    }

    private _decay(): void {
        const now = Date.now();
        for (const chatId of this.willingnessScores.keys()) {
            const session = this.sessions.get(chatId);
            if (!session) continue;

            const config = this._getResolvedConfig(session);
            const { decayHalfLifeSeconds, probabilityThreshold } = config.lifecycle;

            const currentScore = this.willingnessScores.get(chatId) || 0;
            if (currentScore === 0) continue;

            // --- 智能衰减逻辑 ---
            const baseFactor = Math.pow(0.5, 1 / decayHalfLifeSeconds);
            let effectiveFactor = baseFactor;

            // 1. 弹性衰减：意愿值高时，衰减减慢
            if (currentScore > probabilityThreshold) {
                effectiveFactor = 1.0 - (1.0 - baseFactor) * 0.5; // 衰减强度减半
            }

            // 2. 对话热度：如果最近有消息，衰减进一步减慢
            const lastMsgTime = this.lastMessageTimestamps.get(chatId) || 0;
            const silenceDurationMs = now - lastMsgTime;

            if (silenceDurationMs < 15000) {
                // 15秒内有消息，视为"热"
                effectiveFactor = 1.0 - (1.0 - effectiveFactor) * 0.3; // 衰减强度再减70%
            } else if (silenceDurationMs < 60000) {
                // 1分钟内，视为"温"
                effectiveFactor = 1.0 - (1.0 - effectiveFactor) * 0.7; // 衰减强度再减30%
            }
            // 超过1分钟，按原衰减速度

            const newScore = currentScore * effectiveFactor;
            this.willingnessScores.set(chatId, newScore < 0.01 ? 0 : newScore);
        }
    }

    /**
     * 核心计算方法: 根据上下文计算意愿增益
     * 增益计算逻辑: "边际递减"
     * @param context 消息上下文
     * @returns 本次消息产生的意愿增益值
     */
    private calculateGain(session: Session, context: MessageContext) {
        const config = this._getResolvedConfig(session);
        const { base, attribute, interest } = config;

        // 1. 确定基础分
        const allowed = (category: ReplyCategory) => !context.allowedCategories || context.allowedCategories.includes(category);
        let score = allowed("text") ? base.text : 0;
        const gains = { text: score, at: 0, quote: 0, direct: 0 };

        // 2. 叠加属性加成
        if (context.isMentioned && allowed("at")) score += gains.at = attribute.atMention;
        if (context.isQuote && allowed("quote")) score += gains.quote = attribute.isQuote;
        if (context.isDirect && allowed("direct")) score += gains.direct = attribute.isDirectMessage;

        // 3. 应用兴趣度乘数
        const hasKeyword = interest.keywords.some((kw) => context.content.includes(kw));
        const multiplier = hasKeyword ? interest.keywordMultiplier : interest.defaultMultiplier;

        const participationMultiplier = this.getParticipationMultiplier(session, context);
        const rawGain = score * multiplier * participationMultiplier;

        // 4. 应用增益的边际递减效应
        const currentWillingness = this.willingnessScores.get(context.chatId) || 0;
        const maxWillingness = config.lifecycle.maxWillingness;
        // 当意愿值越高时，新的增益效果越差，防止无限累积
        const gainMultiplier = 1 - Math.pow(currentWillingness / maxWillingness, 2);

        const marginalMultiplier = Math.max(0, gainMultiplier);
        return { gain: rawGain * marginalMultiplier, gains, baseScore: score, interestMultiplier: multiplier, participationMultiplier, marginalMultiplier };
    }

    private getParticipationMultiplier(session: Session, context: MessageContext): number {
        const state = this.getParticipation(context.participationId || context.chatId);
        if (!state.active) return 1;

        const allowed = (category: ReplyCategory) => !context.allowedCategories || context.allowedCategories.includes(category);
        const selfId = session.selfId || session.bot?.selfId;
        const mentions = session.elements.filter((element) => element.type === "at");
        const mentionsSelf = !!session.stripped.atSelf || (!!selfId && mentions.some((element) => element.attrs.id === selfId));
        const quoteUserId = session.quote?.user?.id;
        const quotesSelf = !!selfId && quoteUserId === selfId;
        const invited = (mentionsSelf && allowed("at")) || (quotesSelf && allowed("quote"));
        const addressesOthers =
            mentions.some((element) => element.attrs.id && element.attrs.id !== selfId) || (!!quoteUserId && quoteUserId !== selfId);

        // 任意 @/引用可能属于允许的回复类别，但只有明确邀请自身才是参与信号。
        if (!invited && addressesOthers) return 1;
        const sameParticipant = !!state.participantId && state.participantId === session.userId;
        if (!invited && !(context.isDirect && allowed("direct")) && !(sameParticipant && allowed("text"))) return 1;

        const duration = state.expiresAt - state.lastReplyAt;
        const remainingRatio = Math.max(0, Math.min(1, (state.expiresAt - Date.now()) / duration));
        const configuredInfluence = this.baseConfig.participation?.influence ?? 0.5;
        const influence = Number.isFinite(configuredInfluence) ? Math.max(0, Math.min(1, configuredInfluence)) : 0.5;
        return 1 + influence * remainingRatio;
    }

    /**
     * 公开接口：更新意愿值并返回回复概率
     * @param context 消息上下文
     * @returns 回复概率 (0-1)
     */
    public calculateReplyProbability(session: Session, context: MessageContext, assessmentMultiplier = 1,
        capture?: (calculation: Omit<WillingnessCalculation, "roll">) => void): number {
        const { chatId } = context;
        const config = this._getResolvedConfig(session);
        const { lifecycle } = config;

        const resolvedMaxWillingness = session.resolve(lifecycle.maxWillingness);
        const resolvedProbabilityThreshold = session.resolve(lifecycle.probabilityThreshold);
        const resolvedProbabilityAmplifier = session.resolve(lifecycle.probabilityAmplifier);

        const details = this.calculateGain(session, context);
        let currentWillingness = this.willingnessScores.get(chatId) || 0;
        const before = currentWillingness;

        // --- 非线性增益 ---
        const gainMultiplier = getDynamicGainMultiplier(currentWillingness, resolvedMaxWillingness);
        const effectiveGain = details.gain * gainMultiplier * assessmentMultiplier;

        currentWillingness += effectiveGain;
        // -------------------------

        currentWillingness = Math.min(currentWillingness, resolvedMaxWillingness);
        this.willingnessScores.set(chatId, currentWillingness);

        // 转换为概率
        const probability = currentWillingness <= resolvedProbabilityThreshold ? 0
            : Math.max(0, Math.min(1, (currentWillingness - resolvedProbabilityThreshold) * resolvedProbabilityAmplifier));
        capture?.({ before, after: currentWillingness, gains: details.gains, baseScore: details.baseScore, interestMultiplier: details.interestMultiplier,
            marginalMultiplier: details.marginalMultiplier, dynamicMultiplier: gainMultiplier, assessmentMultiplier,
            participationMultiplier: details.participationMultiplier, effectiveGain, maxWillingness: resolvedMaxWillingness,
            threshold: resolvedProbabilityThreshold, amplifier: resolvedProbabilityAmplifier, probability });
        return probability;
    }

    /**
     * 回复前处理：扣除发言成本
     * @param chatId 聊天ID
     */
    public handlePreReply(chatId: string): void {
        // const { lifecycle } = this.config;
        // const currentWillingness = this.willingnessScores.get(chatId) || 0;
        // const newWillingness = Math.max(0, currentWillingness - lifecycle.replyCost);
        // this.willingnessScores.set(chatId, newWillingness);
    }

    /**
     * 在成功回复后执行。重置或降低意愿，进入"冷却期"。
     * @param chatId 聊天ID
     * @param replyContent 回复内容的长度，可以用来决定惩罚力度
     */
    public handlePostReply(session: Session, chatId: string, replyContentLength: number = 0, participationId: string = chatId): void {
        const config = this._getResolvedConfig(session);
        const { replyCost, maxWillingness } = config.lifecycle;

        const resolvedReplyCost = session.resolve(replyCost);

        // 策略1：直接大幅降低意愿值
        // 这种做法模拟了"我说完这个话题了"
        let currentWillingness = this.willingnessScores.get(chatId) || 0;
        currentWillingness -= resolvedReplyCost; // 基础成本
        this.willingnessScores.set(chatId, Math.max(0, currentWillingness));

        if (this.baseConfig.participation?.enabled) {
            const durationSeconds = this.baseConfig.participation.durationSeconds ?? 60;
            if (Number.isFinite(durationSeconds) && durationSeconds >= 1 && durationSeconds <= 86400) {
                const now = Date.now();
                this.participation.set(participationId, {
                    lastReplyAt: now,
                    expiresAt: now + durationSeconds * 1000,
                    participantId: session.userId || null,
                });
            }
        }

        // 策略2：更狠一点，直接清零或设置为一个很低的基础值
        // 这种做法可以有效防止AI在一次回复后，因为意愿值依然很高而立即对下一条消息做出反应，从而避免"连麦"
        //this.willingnessScores.set(chatId, 0); // 直接清零，等待新刺激
        //this.logger.debug(`[${chatId}] 回复成功，意愿值已重置。`);

        // 策略3：动态成本（高级）
        // 回复得越长，消耗的"精力"越多
        // const dynamicCost = replyCost + (replyContentLength / 50); // 每50个字额外增加1点成本
        // let currentWillingness = this.willingnessScores.get(chatId) || 0;
        // this.willingnessScores.set(chatId, Math.max(0, currentWillingness - dynamicCost));
    }

    /**
     * 获取指定聊天的当前意愿值（用于调试和监控）。
     * @param chatId 聊天ID
     */
    public reset(chatId: string): void {
        this.willingnessScores.delete(chatId);
        this.lastMessageTimestamps.delete(chatId);
        this.sessions.delete(chatId);
        this.participation.delete(chatId);
    }

    public getCurrentWillingness(chatId: string): number {
        return this.willingnessScores.get(chatId) || 0;
    }

    /** 返回参与状态的副本；到期查询不会清除或刷新状态。 */
    public getParticipation(chatId: string, now = Date.now()): ParticipationSnapshot {
        const state = this.participation.get(chatId);
        if (!state) return { active: false, lastReplyAt: null, expiresAt: null, participantId: null };
        return {
            ...state,
            active: !!this.baseConfig.participation?.enabled && now >= state.lastReplyAt && now < state.expiresAt,
        };
    }

    /**
     * 核心决策方法：判断是否应该回复。
     * @param session 消息上下文
     * @returns 一个包含决策结果和概率的对象
     */
    public shouldReply(
        session: Session,
        chatId: string = session.cid,
        allowedCategories?: ReplyCategory[],
        assessmentMultiplier = 1,
        topic?: TopicWillingnessInput
    ): { decision: boolean; probability: number; roll: number; calculation: WillingnessCalculation; scoreKey?: string } {
        const currentScoreKey = topic?.currentScoreKey ?? chatId;
        this.sessions.set(currentScoreKey, session);

        const context: MessageContext = {
            chatId: currentScoreKey,
            participationId: topic ? chatId : undefined,
            allowedCategories,
            content: session.content,
            isMentioned: allowedCategories
                ? session.elements.some((e) => e.type === "at") || session.stripped.atSelf
                : session.stripped.atSelf || session.elements.some((e) => e.type === "at" && e.attrs.id === session.bot.selfId),
            isQuote: allowedCategories
                ? !!session.quote || session.elements.some((e) => e.type === "quote")
                : session.quote && session.quote?.user?.id === session.bot.selfId,
            isDirect: session.isDirect,
        };

        let calculation: Omit<WillingnessCalculation, "roll">;
        let probability = this.calculateReplyProbability(session, context,
            assessmentMultiplier * (topic?.multiplier ?? 1), value => { calculation = value; });
        let scoreKey = currentScoreKey;
        if (topic) {
            const configuredPreference = topic.latestTopicPreference ?? 70;
            const preference = (Number.isFinite(configuredPreference) ? Math.max(0, Math.min(100, configuredPreference)) : 70) / 100;
            let bestScore = -Infinity;
            for (const candidate of topic.candidates) {
                const isCurrent = candidate.scoreKey === currentScoreKey;
                if (!(candidate.share > 0) && !isCurrent) continue;
                // Prefer the latest identified topic without changing its reply probability.
                const attentionWeight = (1 - preference) * candidate.share + (isCurrent ? preference : 0);
                if (!(attentionWeight > 0)) continue;
                const weightedScore = this.getCurrentWillingness(candidate.scoreKey) * attentionWeight;
                if (weightedScore > bestScore || (weightedScore === bestScore && candidate.scoreKey === currentScoreKey)) {
                    bestScore = weightedScore;
                    scoreKey = candidate.scoreKey;
                }
            }
            if (scoreKey !== currentScoreKey) {
                this.sessions.set(scoreKey, session);
                probability = this.calculateReplyProbability(session, { ...context, chatId: scoreKey }, 0,
                    value => { calculation = value; });
            }
        }

        const roll = Math.random();
        const decision = roll < probability;

        return { decision, probability, roll, calculation: { ...calculation, roll }, ...(topic ? { scoreKey } : {}) };
    }

    /**
     * 引导模型关注被跳过的话题（用于策略3）
     */
    public boostSkippedTopic(session: Session, chatId: string): void {
        const config = this._getResolvedConfig(session);
        const { maxWillingness } = config.lifecycle;
        const resolvedMaxWillingness = session.resolve(maxWillingness);

        // 提高意愿值，引导模型关注被跳过的话题
        const current = this.willingnessScores.get(chatId) || 0;
        const newValue = Math.min(
            current + resolvedMaxWillingness * 0.7, // 提升70%的意愿值
            resolvedMaxWillingness
        );

        this.willingnessScores.set(chatId, newValue);
        this.logger.debug(`[${chatId}] 引导关注被跳过话题，意愿值: ${current.toFixed(2)} -> ${newValue.toFixed(2)}`);
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
