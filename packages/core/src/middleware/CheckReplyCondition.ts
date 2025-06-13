import { Computed, Context, Random } from "koishi";
import { ConversationFlowAnalyzer } from "../services/ConversationFlowAnalyzer";
import { ChatMessage } from "../types/model";
import { getChannelType } from "../utils";
import { ConversationState, MessageContext, Middleware } from "./base";

// 简化的配置接口
export interface ReplyConditionConfig {
    // 基础配置
    Channels: string[][];
    TestMode?: boolean;

    // 回复策略配置
    Strategies: {
        AtMention: {
            Enabled: boolean;
            // 暂时不清楚Computed的用法，希望可以针对不同群组，不同用户设定不同的回复概率
            // Probability: number | Computed<number>;
            Probability: number;
        };
        Threshold: {
            Enabled: boolean;
            Value: number;
        };
        ConversationFlow: {
            Enabled: boolean;
            ConfidenceThreshold: number;
        };
    };

    // 时间控制
    Timing: {
        WaitTime: number;
        SameUserThreshold: number;
    };

    // 高级功能（可选）
    Advanced?: {
        Willingness?: {
            MessageIncrease: number;
            AtIncrease: number;
            DecayRate: number;
            RetentionAfterReply: number;
            Keywords?: {
            	List: string[];
            	Increase: number;
            }
        };
    };
}

// 回复决策结果
interface ReplyDecision {
    shouldReply: boolean;
    strategy: string;
    confidence: number;
    waitTime: number;
    reason: string;
}

// 频道状态
interface ChannelState {
    willingness: number;
    processing: boolean;
    lastMessageTime: number;
    lastMessageUser: string;
}

// 回复策略接口
interface ReplyStrategy {
    name: string;
    enabled: boolean;
    evaluate(ctx: MessageContext, state: ChannelState): Promise<ReplyDecision>;
}

// @提及策略
class AtMentionStrategy implements ReplyStrategy {
    name = "at_mention";
    enabled: boolean;

    constructor(private config: ReplyConditionConfig['Strategies']['AtMention']) {
        this.enabled = config.Enabled;
    }

    async evaluate(ctx: MessageContext): Promise<ReplyDecision> {
        if (!ctx.isMentioned) {
            return {
                shouldReply: false,
                strategy: this.name,
                confidence: 0,
                waitTime: 1000,
                reason: "not_mentioned",
            };
        }

        const shouldReply = Random.bool(this.config.Probability);

        return {
            shouldReply,
            strategy: this.name,
            confidence: shouldReply ? 1.0 : 0,
            waitTime: 1000, // 快速响应@消息
            reason: shouldReply ? "direct_mention" : "mention_probability_failed",
        };
    }
}

// 阈值策略
class ThresholdStrategy implements ReplyStrategy {
    name = "threshold";
    enabled: boolean;

    constructor(private config: ReplyConditionConfig["Strategies"]["Threshold"]) {
        this.enabled = config.Enabled;
    }

    async evaluate(ctx: MessageContext, state: ChannelState): Promise<ReplyDecision> {
        const threshold = this.config.Value;
        const confidence = Math.min(state.willingness / threshold, 1.0);
        const shouldReply = state.willingness >= threshold;

        return {
            shouldReply,
            strategy: this.name,
            confidence,
            waitTime: 3000, // 标准等待时间
            reason: shouldReply ? "threshold_reached" : "threshold_not_reached",
        };
    }
}

// 对话流策略
class ConversationFlowStrategy implements ReplyStrategy {
    name = "conversation_flow";
    enabled: boolean;

    constructor(private config: ReplyConditionConfig["Strategies"]["ConversationFlow"], private flowAnalyzer: ConversationFlowAnalyzer) {
        this.enabled = config.Enabled;
    }

    async evaluate(ctx: MessageContext): Promise<ReplyDecision> {
        const channelId = ctx.koishiSession.channelId;
        const userId = ctx.koishiSession.author.id;

        // 构造消息对象
        const message: ChatMessage = {
            messageId: ctx.koishiSession.messageId,
            content: ctx.koishiSession.content,
            sender: {
                id: userId,
                name: ctx.koishiSession.author.name || ctx.koishiSession.author.nick,
                nick: ctx.koishiSession.author.nick,
            },
            timestamp: new Date(ctx.koishiSession.timestamp),
            channel: { id: channelId, type: getChannelType(channelId) },
        };

        // 分析对话流
        await this.flowAnalyzer.analyzeMessage(channelId, message);
        const flowDecision = this.flowAnalyzer.shouldReply(channelId, message);

        const shouldReply = flowDecision.shouldReply && flowDecision.confidence >= this.config.ConfidenceThreshold;

        return {
            shouldReply,
            strategy: this.name,
            confidence: flowDecision.confidence,
            waitTime: flowDecision.suggestedWaitTime || 3000,
            reason: flowDecision.reason,
        };
    }
}

// 简化的意愿值服务
class WillingnessService {
    private channelWillingness = new Map<string, number>();

    constructor(private config?: ReplyConditionConfig["Advanced"]["Willingness"]) {}

    updateWillingness(channelId: string, isMentioned: boolean, messageContent: string): void {
        if (!this.config) return;

        const current = this.channelWillingness.get(channelId) || 0;
        
        // 基础增加量
        let increase = isMentioned ? this.config.AtIncrease : this.config.MessageIncrease;
        
        // 关键词检测 - 每匹配一个关键词增加额外意愿值
        if (this.config.Keywords && messageContent) {
            const lowerContent = messageContent.toLowerCase();
            const matchedKeywords = this.config.Keywords.List.filter(keyword => 
                lowerContent.includes(keyword.toLowerCase())
            );
            if (matchedKeywords.length > 0) {
                increase += this.config.Keywords.Increase * matchedKeywords.length;
            }
        }

        const newWillingness = Math.max(0, current + increase);
        this.channelWillingness.set(channelId, newWillingness);
        
    }

    getWillingness(channelId: string): number {
        return this.channelWillingness.get(channelId) || 0;
    }

    resetAfterReply(channelId: string): void {
        if (!this.config) return;

        const current = this.getWillingness(channelId);
        const retained = current * this.config.RetentionAfterReply;
        this.channelWillingness.set(channelId, retained);
    }

    decay(): void {
        if (!this.config) return;

        for (const [channelId, willingness] of this.channelWillingness) {
            const decayed = Math.max(0, willingness - this.config.DecayRate);
            this.channelWillingness.set(channelId, decayed);
        }
    }
}

export class CheckReplyCondition extends Middleware {
    private strategies: ReplyStrategy[] = [];
    private channelStates = new Map<string, ChannelState>();
    private delayTimers = new Map<string, NodeJS.Timeout>();
    private willingnessService: WillingnessService;
    private decayTimer?: NodeJS.Timeout;

    constructor(public ctx: Context, public config: ReplyConditionConfig) {
        super("check-reply-condition", ctx, null, config);

        this.willingnessService = new WillingnessService(config.Advanced?.Willingness);
        this.initializeStrategies();
        this.startDecayTimer();
    }

    private initializeStrategies(): void {
        // 初始化@提及策略
        if (this.config.Strategies.AtMention.Enabled) {
            this.strategies.push(new AtMentionStrategy(this.config.Strategies.AtMention));
        }

        // 初始化阈值策略
        if (this.config.Strategies.Threshold.Enabled) {
            this.strategies.push(new ThresholdStrategy(this.config.Strategies.Threshold));
        }

        // 初始化对话流策略
        if (this.config.Strategies.ConversationFlow.Enabled) {
            const flowAnalyzer = new ConversationFlowAnalyzer(this.ctx);
            this.strategies.push(new ConversationFlowStrategy(this.config.Strategies.ConversationFlow, flowAnalyzer));
        }
    }

    private startDecayTimer(): void {
        if (!this.config.Advanced?.Willingness) return;

        // 每分钟衰减一次
        this.decayTimer = setInterval(() => {
            this.willingnessService.decay();
        }, 60000);
    }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        const channelId = ctx.koishiSession.channelId;
        const userId = ctx.koishiSession.author.id;
        const now = Date.now();

        // 基础检查
        if (ctx.koishiSession.author.isBot) return;
        if (!this.isAllowedChannel(channelId)) return;
        if (this.isChannelProcessing(channelId)) return;

        // 获取或创建频道状态
        const state = this.getOrCreateChannelState(channelId);

        // 更新意愿值
        this.willingnessService.updateWillingness(
        	channelId, 
        	ctx.isMentioned,
        	ctx.koishiSession.content
        );
        state.willingness = this.willingnessService.getWillingness(channelId);

        // 检查是否需要取消现有定时器
        if (this.shouldCancelExistingTimer(state, userId, now)) {
            this.cancelExistingTimer(channelId);
        } else if (this.delayTimers.has(channelId)) {
            // 如果不取消且已有定时器，直接返回
            return;
        }

        // 更新状态
        state.lastMessageTime = now;
        state.lastMessageUser = userId;

        // 启动新的延迟处理
        this.startDelayedProcessing(ctx, next, state);
    }

    private isAllowedChannel(channelId: string): boolean {
        return this.config.Channels.some((slot) => slot.includes(channelId));
    }

    private isChannelProcessing(channelId: string): boolean {
        const state = this.channelStates.get(channelId);
        return state?.processing || false;
    }

    private getOrCreateChannelState(channelId: string): ChannelState {
        let state = this.channelStates.get(channelId);
        if (!state) {
            state = {
                willingness: 0,
                processing: false,
                lastMessageTime: 0,
                lastMessageUser: "",
            };
            this.channelStates.set(channelId, state);
        }
        return state;
    }

    private shouldCancelExistingTimer(state: ChannelState, userId: string, now: number): boolean {
        // 如果是同一用户在短时间内的连续消息，取消之前的定时器
        return state.lastMessageUser === userId && now - state.lastMessageTime < this.config.Timing.SameUserThreshold;
    }

    private cancelExistingTimer(channelId: string): void {
        const timer = this.delayTimers.get(channelId);
        if (timer) {
            clearTimeout(timer);
            this.delayTimers.delete(channelId);
        }
    }

    private startDelayedProcessing(ctx: MessageContext, next: () => Promise<void>, state: ChannelState): void {
        const channelId = ctx.koishiSession.channelId;
        const waitTime = this.config.Timing.WaitTime;

        const timer = setTimeout(async () => {
            try {
                await this.processMessage(ctx, next, state);
            } catch (error) {
                this.ctx.logger.error(`[CheckReplyCondition] 处理消息失败: ${error.message}`);
                state.processing = false;
            } finally {
                this.delayTimers.delete(channelId);
            }
        }, waitTime);

        this.delayTimers.set(channelId, timer);
    }

    private async processMessage(ctx: MessageContext, next: () => Promise<void>, state: ChannelState): Promise<void> {
        const channelId = ctx.koishiSession.channelId;

        // 标记为处理中
        state.processing = true;

        try {
            // 评估所有策略
            const decisions = await Promise.all(
                this.strategies.filter((strategy) => strategy.enabled).map((strategy) => strategy.evaluate(ctx, state))
            );

            // 找到应该回复的决策
            const positiveDecision = decisions.find((decision) => decision.shouldReply);
            const shouldReply = !!positiveDecision || this.config.TestMode;

            // 记录日志
            this.logDecision(channelId, ctx.koishiSession.author.id, decisions, shouldReply);

            if (shouldReply) {
                // 重置意愿值
                this.willingnessService.resetAfterReply(channelId);
                state.willingness = this.willingnessService.getWillingness(channelId);

                // 设置处理状态并继续中间件链
                ctx.state = ConversationState.PROCESSING;
                await next();
            }
        } finally {
            state.processing = false;
        }
    }

    private logDecision(channelId: string, userId: string, decisions: ReplyDecision[], shouldReply: boolean): void {
        const summary = decisions.map((d) => `${d.strategy}:${d.shouldReply}(${d.confidence.toFixed(2)})`).join(", ");

        this.ctx.logger.info(
            `[CheckReplyCondition] channelId: ${channelId}, userId: ${userId}, ` + `strategies: [${summary}], shouldReply: ${shouldReply}`
        );
    }

    // 清理资源
    public destroy(): void {
        // 清理衰减定时器
        if (this.decayTimer) {
            clearInterval(this.decayTimer);
            this.decayTimer = undefined;
        }

        // 清理延迟处理定时器
        for (const timer of this.delayTimers.values()) {
            clearTimeout(timer);
        }
        this.delayTimers.clear();
    }

    // 提供状态查询接口（用于调试）
    public getChannelState(channelId: string): ChannelState | undefined {
        return this.channelStates.get(channelId);
    }

    public getWillingness(channelId: string): number {
        return this.willingnessService.getWillingness(channelId);
    }
}
