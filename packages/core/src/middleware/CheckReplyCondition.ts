import { Context, Random } from "koishi";
import { ConversationState, MessageContext, Middleware } from "./base";
import { AdapterSwitcher } from "../adapters";

// 用户优先级类型
export type UserPriorityLevel = 'high' | 'normal' | 'low' | 'ignore';

// 用户交互记录
interface UserInteraction {
    lastInteraction: number;
    interactionCount: number;
    positiveInteractions: number;
}

// 用户关注状态
interface UserAttention {
    expireTime: number;
    attentionLevel: number;
}

// 新的配置选项
export interface CheckReplyConditionOptions {
    // 允许的频道
    allowedChannels: string[];
    // 测试模式，每条消息都会触发回复
    testMode: boolean;
    // at回复概率
    atReactPossibility: number;
    // 意愿增加量
    increaseWillingnessOn: {
        // 收到消息
        message: number;
        // 收到 @ 消息
        at: number;
    };
    // 回复阈值
    threshold: number;
    // 消息等待时间(毫秒)
    messageWaitTime: number;
    // 判定为同一用户连续消息的时间阈值(毫秒)
    sameUserThreshold: number;
    // 衰减检查间隔(毫秒)
    decayInterval?: number;
    // 基础衰减率(每分钟)
    decayRate?: number;
    // 基础意愿值，最低不会低于此值
    baseWillingness?: number;
    // @后关注持续时间(毫秒)
    attentionDuration?: number;
    // 初始关注程度
    initialAttentionLevel?: number;
    // 回复后保留的意愿值比例
    postReplyRetention?: number;
    // 默认用户优先级
    defaultUserPriority?: UserPriorityLevel;
    // 不同优先级的相关系数
    prioritySettings?: {
        // 衰减系数
        decayMultipliers: Record<UserPriorityLevel, number>;
        // 关注系数
        attentionMultipliers: Record<UserPriorityLevel, number>;
        // 阈值系数
        thresholdMultipliers: Record<UserPriorityLevel, number>;
    };
    // 用户优先级初始配置
    userPriorities?: Record<string, UserPriorityLevel>;
}

// 检查是否达到回复条件
export class CheckReplyConditionMiddleware implements Middleware {
    name = 'check-reply-condition';

    /**
     * 回复意愿
     *
     * 下列行为会增加意愿值：
     * - 收到消息
     * - 收到 @ 消息
     * - 收到 @ 消息且满足回复条件
     *
     * 意愿值超过阈值时触发回复
     *
     * 意愿值会随时间自然衰减，回复后会降低但不会完全重置
     */
    private currentThreshold = new Map<string, number>();

    // 用户特定的意愿值 Map<channelId, Map<userId, number>>
    private userWillingnessMap = new Map<string, Map<string, number>>();

    // 用户优先级 Map<userId, UserPriorityLevel>
    private userPriorityMap = new Map<string, UserPriorityLevel>();

    // 用户被@后的关注状态 Map<channelId, Map<userId, {expireTime, attentionLevel}>>
    private userAttentionMap = new Map<string, Map<string, UserAttention>>();

    // 用户历史互动记录 Map<userId, {lastInteraction, interactionCount, positiveInteractions}>
    private userInteractionHistory = new Map<string, UserInteraction>();

    // 最后衰减时间 Map<channelId, timestamp>
    private lastDecayTime = new Map<string, number>();

    // 衰减定时器
    private decayTimer: NodeJS.Timeout | null = null;

    // 当前频道处理状态 (channelId -> 是否正在处理)
    private channelProcessingState = new Map<string, boolean>();
    // 延迟处理定时器 (channelId -> 定时器)
    private delayTimers = new Map<string, NodeJS.Timeout>();
    // 最近发送消息的用户 (channelId -> {userId, timestamp})
    private lastMessageSenders = new Map<string, { userId: string, timestamp: number }>();

    // 默认优先级设置
    private defaultPrioritySettings = {
        decayMultipliers: {
            high: 0.5,     // 高优先级用户意愿值衰减慢
            normal: 1.0,   // 正常衰减
            low: 1.5,      // 低优先级用户意愿值衰减快
            ignore: 3.0    // 忽略的用户意愿值衰减非常快
        },
        attentionMultipliers: {
            high: 1.5,     // 高优先级用户获得更多关注
            normal: 1.0,   // 正常关注
            low: 0.5,      // 低优先级用户获得较少关注
            ignore: 0.1    // 忽略的用户几乎不获得关注
        },
        thresholdMultipliers: {
            high: 0.6,     // 高优先级用户的阈值更低
            normal: 1.0,   // 正常阈值
            low: 1.5,      // 低优先级用户需要更高的意愿值
            ignore: 5.0    // 忽略的用户需要非常高的意愿值
        }
    };

    constructor(
        private options: CheckReplyConditionOptions,
        private koishiContext?: Context,
        private adapterSwitcher?: AdapterSwitcher
    ) {
        // 设置默认值
        this.options.decayInterval = this.options.decayInterval || 60000; // 1分钟
        this.options.decayRate = this.options.decayRate || 5; // 每分钟衰减5点
        this.options.baseWillingness = this.options.baseWillingness || 0;
        this.options.attentionDuration = this.options.attentionDuration || 300000; // 5分钟
        this.options.initialAttentionLevel = this.options.initialAttentionLevel || 60;
        this.options.postReplyRetention = this.options.postReplyRetention || 0.3; // 保留30%
        this.options.defaultUserPriority = this.options.defaultUserPriority || 'normal';
        this.options.prioritySettings = this.options.prioritySettings || this.defaultPrioritySettings;

        // 初始化用户优先级配置
        if (this.options.userPriorities) {
            for (const [userId, priority] of Object.entries(this.options.userPriorities)) {
                this.userPriorityMap.set(userId, priority);
            }
        }

        // 启动衰减定时器
        this.decayTimer = setInterval(() => this.decayWillingness(), this.options.decayInterval);
    }

    /**
     * 析构函数，清理资源
     */
    public destroy() {
        // 清理衰减定时器
        if (this.decayTimer) {
            clearInterval(this.decayTimer);
            this.decayTimer = null;
        }

        // 清理延迟处理定时器
        for (const timer of this.delayTimers.values()) {
            clearTimeout(timer);
        }
        this.delayTimers.clear();
    }

    /**
     * 设置用户优先级
     */
    public setUserPriority(userId: string, level: UserPriorityLevel) {
        this.userPriorityMap.set(userId, level);
    }

    /**
     * 获取用户优先级
     */
    public getUserPriority(userId: string): UserPriorityLevel {
        return this.userPriorityMap.get(userId) || this.options.defaultUserPriority || 'normal';
    }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        const channelId = ctx.koishiSession.channelId;
        const userId = ctx.koishiSession.author.id;
        const now = Date.now();

        // 忽略机器人消息
        if (ctx.koishiSession.author.isBot) return;

        // 忽略非指定频道的消息
        if (!this.options.allowedChannels.includes(ctx.koishiSession.channelId)) return;

        // 如果当前频道已有处理任务，则忽略新的触发条件
        if (this.channelProcessingState.get(channelId)) return;

        // 获取用户优先级
        const userPriority = this.getUserPriority(userId);

        // 如果用户被设为忽略且没有被@，直接跳过处理
        if (userPriority === 'ignore' && !ctx.isMentioned) return;

        // 处理频道整体意愿值
        let currentThreshold = this.currentThreshold.get(channelId) || 0;

        // 处理用户特定意愿值
        const channelUserMap = this.userWillingnessMap.get(channelId) || new Map();
        let userWillingness = channelUserMap.get(userId) || 0;

        // 根据用户优先级计算意愿值增加量
        const baseIncrease = this.options.increaseWillingnessOn.message;
        const priorityMultiplier = this.getPrioritySettingValue('thresholdMultipliers', userPriority);
        const actualIncrease = baseIncrease / priorityMultiplier; // 高优先级用户增加更多

        // 更新意愿值
        currentThreshold += this.options.increaseWillingnessOn.message;
        userWillingness += actualIncrease;

        // 更新存储
        this.currentThreshold.set(channelId, currentThreshold);
        channelUserMap.set(userId, userWillingness);
        this.userWillingnessMap.set(channelId, channelUserMap);

        // 处理@逻辑
        if (ctx.isMentioned) {
            this.handleMention(channelId, userId);
        }

        // 处理延迟逻辑
        const lastSender = this.lastMessageSenders.get(channelId);

        // 更新最近发送消息的用户信息
        this.lastMessageSenders.set(channelId, { userId, timestamp: now });

        // 如果有未完成的定时器，且是同一用户在阈值时间内的消息，则取消之前的定时器
        if (this.delayTimers.has(channelId) &&
            lastSender &&
            lastSender.userId === userId &&
            now - lastSender.timestamp < this.options.sameUserThreshold) {

            clearTimeout(this.delayTimers.get(channelId));
        }

        await new Promise<void>((resolve, reject) => {
            // 设置新的定时器
            const timer = setTimeout(async () => {
                try {
                    await this.processMessages(ctx, next);
                    resolve();
                } catch (e) {
                    this.releaseChannelState(ctx.koishiSession.channelId);
                    reject(e);
                }
            }, this.options.messageWaitTime);
            this.delayTimers.set(channelId, timer);
        });
    }

    /**
     * 处理@逻辑
     */
    private handleMention(channelId: string, userId: string) {
        const now = Date.now();

        // 获取或创建该频道的用户关注映射
        let attentionMap = this.userAttentionMap.get(channelId);
        if (!attentionMap) {
            attentionMap = new Map();
            this.userAttentionMap.set(channelId, attentionMap);
        }

        // 获取用户优先级
        const userPriority = this.getUserPriority(userId);

        // 设置持续关注时间和程度
        const expireTime = now + (this.options.attentionDuration || 300000);
        const baseAttention = this.options.initialAttentionLevel || 50;

        // 根据用户优先级调整关注程度
        const attentionMultiplier = this.getPrioritySettingValue('attentionMultipliers', userPriority);
        const attentionLevel = baseAttention * attentionMultiplier;

        // 设置或更新关注状态
        attentionMap.set(userId, { expireTime, attentionLevel });

        // 同时增加频道整体意愿值
        const channelThreshold = this.currentThreshold.get(channelId) || 0;
        this.currentThreshold.set(
            channelId,
            Math.min(100, channelThreshold + this.options.increaseWillingnessOn.at)
        );
    }

    /**
     * 意愿值衰减处理
     */
    private decayWillingness() {
        const now = Date.now();

        // 衰减频道整体意愿值
        for (const [channelId, threshold] of this.currentThreshold.entries()) {
            const lastDecay = this.lastDecayTime.get(channelId) || now;
            const timePassed = now - lastDecay;
            const decayAmount = this.calculateDecayAmount(threshold, timePassed);

            // 应用衰减，不低于基础值
            const newThreshold = Math.max(
                this.options.baseWillingness || 0,
                threshold - decayAmount
            );
            this.currentThreshold.set(channelId, newThreshold);
        }

        // 衰减用户特定意愿值
        for (const [channelId, userMap] of this.userWillingnessMap.entries()) {
            for (const [userId, willingness] of userMap.entries()) {
                // 获取用户优先级以调整衰减率
                const priority = this.getUserPriority(userId);
                const decayRateMultiplier = this.getPrioritySettingValue('decayMultipliers', priority);

                const decayAmount = this.calculateUserDecayAmount(willingness, decayRateMultiplier);

                // 应用衰减
                const newWillingness = Math.max(0, willingness - decayAmount);
                userMap.set(userId, newWillingness);
            }
        }

        // 更新最后衰减时间
        for (const channelId of this.currentThreshold.keys()) {
            this.lastDecayTime.set(channelId, now);
        }

        // 清理过期的用户关注状态
        this.cleanupExpiredAttention(now);
    }

    /**
     * 计算频道意愿值衰减量
     */
    private calculateDecayAmount(threshold: number, timePassed: number): number {
        // 基础衰减率（每分钟）
        const baseDecayRate = this.options.decayRate || 5;

        // 根据时间计算应该衰减的量
        const minutesPassed = timePassed / 60000;
        const decayAmount = baseDecayRate * minutesPassed;

        // 意愿值越高，衰减越快（非线性衰减）
        const adjustedDecay = decayAmount * (1 + threshold / 100);

        return adjustedDecay;
    }

    /**
     * 计算用户特定意愿值衰减量
     */
    private calculateUserDecayAmount(willingness: number, decayRateMultiplier: number): number {
        // 基础衰减率（每分钟）
        const baseDecayRate = this.options.decayRate || 5;

        // 根据用户优先级调整衰减率
        const adjustedDecayRate = baseDecayRate * decayRateMultiplier;

        // 非线性衰减：意愿值越高衰减越快
        const adjustedDecay = adjustedDecayRate * (1 + willingness / 100);

        return adjustedDecay;
    }

    /**
     * 清理过期的用户关注状态
     */
    private cleanupExpiredAttention(now: number) {
        for (const [channelId, attentionMap] of this.userAttentionMap.entries()) {
            for (const [userId, attention] of attentionMap.entries()) {
                if (attention.expireTime < now) {
                    attentionMap.delete(userId);
                }
            }

            // 如果频道没有任何关注的用户，清除该频道
            if (attentionMap.size === 0) {
                this.userAttentionMap.delete(channelId);
            }
        }
    }

    /**
     * 从优先级设置中获取特定值
     */
    private getPrioritySettingValue(settingType: 'decayMultipliers' | 'attentionMultipliers' | 'thresholdMultipliers', priority: UserPriorityLevel): number {
        const defaultValue = 1.0;

        if (!this.options.prioritySettings) {
            return defaultValue;
        }

        const settings = this.options.prioritySettings[settingType];
        if (!settings) {
            return defaultValue;
        }

        return settings[priority] || defaultValue;
    }

    private async processMessages(ctx: MessageContext, next: () => Promise<void>) {
        const channelId = ctx.koishiSession.channelId;
        const userId = ctx.koishiSession.author.id;

        // 清除定时器
        this.delayTimers.delete(channelId);

        // 获取频道意愿值
        const channelThreshold = this.currentThreshold.get(channelId) || 0;

        // 获取用户专属意愿值
        const userMap = this.userWillingnessMap.get(channelId) || new Map();
        const userWillingness = userMap.get(userId) || 0;

        // 检查用户是否处于被关注状态
        const attentionMap = this.userAttentionMap.get(channelId) || new Map();
        const attention = attentionMap.get(userId);
        const isUnderAttention = attention && attention.expireTime > Date.now();

        // 获取用户优先级
        const userPriority = this.getUserPriority(userId);

        // 根据优先级调整阈值
        const thresholdMultiplier = this.getPrioritySettingValue('thresholdMultipliers', userPriority);
        const adjustedThreshold = this.options.threshold * thresholdMultiplier;

        // 决定是否回复
        const shouldReactToAt = ctx.isMentioned && Random.bool(this.options.atReactPossibility);
        const isThresholdReached = channelThreshold >= adjustedThreshold;
        const isUserThresholdReached = userWillingness >= (adjustedThreshold * 0.7);
        const isAttentionTriggered = isUnderAttention && (Math.random() < (attention?.attentionLevel || 0) / 100);

        const shouldReply = shouldReactToAt ||
            isThresholdReached ||
            isUserThresholdReached ||
            isAttentionTriggered ||
            this.options.testMode;

        ctx.koishiContext.logger.info(
            `[CheckReplyCondition] channelId: ${channelId}, userId: ${userId}, ` +
            `priority: ${userPriority}, channelThreshold: ${channelThreshold}, ` +
            `userWillingness: ${userWillingness}, adjustedThreshold: ${adjustedThreshold}, ` +
            `isUnderAttention: ${isUnderAttention}, shouldReply: ${shouldReply}`
        );

        if (shouldReply) {
            // 标记频道为正在处理状态
            this.channelProcessingState.set(channelId, true);

            // 设置状态为处理中并继续中间件链
            ctx.state = ConversationState.PROCESSING;

            // 降低意愿值，但不完全重置
            const retentionRate = this.options.postReplyRetention || 0.3;
            this.currentThreshold.set(channelId, channelThreshold * retentionRate);

            // 用户意愿值也降低
            if (userMap.has(userId)) {
                userMap.set(userId, userWillingness * retentionRate);
            }

            await next();
        }
    }

    /**
     * 处理用户反馈
     * @param channelId 频道ID
     * @param userId 用户ID
     * @param isPositive 是否是正面反馈
     */
    public async processUserFeedback(channelId: string, userId: string, isPositive: boolean) {
        // 更新用户互动历史
        const history = this.userInteractionHistory.get(userId) || {
            lastInteraction: Date.now(),
            interactionCount: 0,
            positiveInteractions: 0
        };

        history.lastInteraction = Date.now();
        history.interactionCount++;
        if (isPositive) {
            history.positiveInteractions++;
        }

        this.userInteractionHistory.set(userId, history);

        // 根据互动历史动态调整用户优先级
        this.updateUserPriorityBasedOnHistory(userId);

        // 记录日志
        this.koishiContext?.logger.info(
            `[CheckReplyCondition] 处理用户反馈: userId=${userId}, ` +
            `isPositive=${isPositive}, interactionCount=${history.interactionCount}, ` +
            `positiveRate=${history.positiveInteractions / history.interactionCount}`
        );
    }

    /**
     * 根据互动历史更新用户优先级
     */
    private updateUserPriorityBasedOnHistory(userId: string) {
        const history = this.userInteractionHistory.get(userId);
        if (!history || history.interactionCount < 5) {
            return; // 互动次数太少，不调整
        }

        // 计算正面互动率
        const positiveRate = history.positiveInteractions / history.interactionCount;

        // 根据互动频率和正面率调整优先级
        let newPriority: UserPriorityLevel;

        if (positiveRate > 0.8) {
            newPriority = 'high';
        } else if (positiveRate > 0.5) {
            newPriority = 'normal';
        } else if (positiveRate > 0.2) {
            newPriority = 'low';
        } else {
            newPriority = 'ignore';
        }

        // 设置新优先级
        this.userPriorityMap.set(userId, newPriority);
    }

    /**
     * 使用LLM判断用户反馈的积极性
     * @param userMessages 用户最近的消息记录
     * @returns 是否为积极反馈
     */
    public async analyzeUserFeedback(userMessages: string[]): Promise<boolean> {
        if (!this.adapterSwitcher || !this.koishiContext) {
            return false; // 如果没有adapter，默认为非积极反馈
        }

        // 获取适配器
        const { adapter } = this.adapterSwitcher.getAdapter();
        if (!adapter) {
            return false;
        }

        try {
            // 构建提示词
            const prompt = this.getFeedbackAnalysisPrompt(userMessages);

            // 发送LLM请求
            const result = await adapter.chat([
                { role: 'system', content: prompt }
            ], null, {
                debug: false,
                logger: this.koishiContext.logger,
            });

            // 解析结果
            const response = result.text.toLowerCase().trim();
            return response.includes('positive') || response.includes('积极');
        } catch (error) {
            this.koishiContext.logger.error(`[CheckReplyCondition] 分析用户反馈失败: ${error.message}`);
            return false;
        }
    }

    /**
     * 构建用户反馈分析的提示词
     */
    private getFeedbackAnalysisPrompt(userMessages: string[]): string {
        return `
你需要判断以下用户消息是否表达了对AI助手回复的积极态度。

请分析这些消息并确定用户的态度是积极的还是消极的。
- 如果用户表达了满意、感谢、赞赏或喜欢，那就是积极的。
- 如果用户表达了不满、困惑、失望或批评，那就是消极的。
- 如果用户只是继续对话但没有明确表达态度，也视为中性或略微积极。

请只回复"positive"（积极）或"negative"（消极）一个词，不要包含任何其他文本。

用户消息:
${userMessages.map(msg => `"${msg}"`).join('\n')}
`;
    }

    // 提供一个方法供LLMHandlingMiddleware调用，用于释放频道处理状态
    releaseChannelState(channelId: string) {
        this.channelProcessingState.set(channelId, false);
    }
}
