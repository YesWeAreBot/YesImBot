import { Context } from "koishi";
import { BaseMiddleware, MiddlewareContext } from "./base";
import { ChatMessage, ConversationFlowAnalyzer, getChannelType, ReplyDecision } from "../shared";

/**
 * 回复条件中间件配置
 */
export interface ReplyConditionConfig {
    Channels: string[][];
    TestMode?: boolean;
    Strategies: {
        AtMention: {
            Enabled: boolean;
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
    Timing: {
        WaitTime: number;
        SameUserThreshold: number;
    };
    Advanced?: {
        Willingness?: {
            MessageIncrease: number;
            AtIncrease: number;
            DecayRate: number;
            RetentionAfterReply: number;
            Keywords?: {
                List: string[];
                Increase: number;
            };
        };
    };
}

/**
 * 意愿值管理器
 */
class WillingnessManager {
    private willingnessMap = new Map<string, number>();
    private lastDecayTime = Date.now();

    constructor(private config: ReplyConditionConfig["Advanced"]) {}

    /**
     * 增加意愿值
     */
    increaseWillingness(channelId: string, amount: number): void {
        const current = this.willingnessMap.get(channelId) || 0;
        this.willingnessMap.set(channelId, Math.min(100, current + amount));
    }

    /**
     * 获取当前意愿值
     */
    getWillingness(channelId: string): number {
        this.decayWillingness();
        return this.willingnessMap.get(channelId) || 0;
    }

    /**
     * 回复后保留意愿值
     */
    retainAfterReply(channelId: string): void {
        const current = this.willingnessMap.get(channelId) || 0;
        const retention = this.config?.Willingness?.RetentionAfterReply || 0.3;
        this.willingnessMap.set(channelId, current * retention);
    }

    /**
     * 意愿值衰减
     */
    private decayWillingness(): void {
        const now = Date.now();
        const elapsed = now - this.lastDecayTime;
        const minutes = elapsed / (60 * 1000);

        if (minutes >= 1) {
            const decayRate = this.config?.Willingness?.DecayRate || 2;

            for (const [channelId, willingness] of this.willingnessMap) {
                const newWillingness = Math.max(0, willingness - decayRate * minutes);
                this.willingnessMap.set(channelId, newWillingness);
            }

            this.lastDecayTime = now;
        }
    }
}

export class ReplyConditionMiddleware extends BaseMiddleware<ReplyConditionConfig> {
    private willingnessManager: WillingnessManager;
    private lastMessageTimes = new Map<string, number>();
    private flowAnalyzer: ConversationFlowAnalyzer;

    constructor(ctx: Context, config: ReplyConditionConfig) {
        super("", ctx, config);
        this.willingnessManager = new WillingnessManager(config.Advanced);
        this.flowAnalyzer = new ConversationFlowAnalyzer(ctx);
    }

    async execute(ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> {
        const startTime = Date.now();
        const channelId = ctx.koishiSession.channelId;
        const userId = ctx.koishiSession.userId;

        // 简洁的日志标题
        this.logger.info(`📋 回复条件检查 - 频道: ${channelId} | 用户: ${userId}`);

        try {
            // 1. 基础频道检查
            if (!this.checkChannelPermission(ctx)) {
                this.logger.warn(`   ❌ 频道不在允许列表中 (配置频道: ${JSON.stringify(this.config.Channels)})`);
                return;
            }
            this.logger.info(`   ✅ 频道权限检查通过`);

            // 2. 测试模式检查
            if (this.config.TestMode) {
                this.logger.info(`   🧪 测试模式：强制回复`);
                await next();
                return;
            }

            // 3. 时间控制检查
            if (!this.checkTiming(ctx)) {
                this.logger.info(`   ⏸️ 时间控制：跳过回复`);
                return;
            }
            this.logger.info(`   ✅ 时间控制检查通过`);

            // 4. 回复策略检查
            this.logger.info(`   🔍 开始评估回复策略...`);
            const shouldReply = await this.evaluateReplyStrategies(ctx);

            if (shouldReply) {
                this.logger.info(`   🎉 满足回复条件，准备回复`);

                await next();

                // 回复后处理意愿值
                this.willingnessManager.retainAfterReply(channelId);
                this.logger.info(`   🔄 回复完成，意愿值已更新`);
            } else {
                this.logger.info(`   🚫 不满足回复条件`);
            }
        } finally {
            const duration = Date.now() - startTime;
            this.logger.info(`   ⏱️ 处理完成，耗时 ${duration}ms`);
            this.logger.info(`──────────────────────────`);
        }
    }


    /**
     * 检查频道权限
     */
    private checkChannelPermission(ctx: MiddlewareContext): boolean {
        const channelId = ctx.koishiSession.channelId;
        return this.config.Channels.some((slots) => slots.includes(channelId));
    }

    /**
     * 检查时间控制
     */
    private checkTiming(ctx: MiddlewareContext): boolean {
        const now = Date.now();
        const channelId = ctx.koishiSession.channelId;
        const userId = ctx.koishiSession.userId;
        const userChannelKey = `${userId}:${channelId}`;

        // 检查等待时间
        const lastMessageTime = this.lastMessageTimes.get(channelId) || 0;
        if (now - lastMessageTime < this.config.Timing.WaitTime) {
            return false;
        }

        // 检查同用户阈值
        const lastUserMessageTime = this.lastMessageTimes.get(userChannelKey) || 0;
        if (now - lastUserMessageTime < this.config.Timing.SameUserThreshold) {
            return false;
        }

        // 更新时间记录
        this.lastMessageTimes.set(channelId, now);
        this.lastMessageTimes.set(userChannelKey, now);

        return true;
    }

    /**
     * 评估回复策略
     */
    private async evaluateReplyStrategies(ctx: MiddlewareContext): Promise<boolean> {
        const channelId = ctx.koishiSession.channelId;
        const userId = ctx.koishiSession.userId;
        const strategies = this.config.Strategies;
        let shouldReply = false;
        const reasons: string[] = [];

        // 策略评估标题
        this.logger.info(`   📊 回复策略评估:`);

        // 1. @提及策略
        if (strategies.AtMention.Enabled) {
            const probability = strategies.AtMention.Probability;

            if (ctx.isMentioned) {
                const willReply = Math.random() < probability;
                const result = willReply ? "✅ 触发" : "❌ 未触发";
                shouldReply = willReply;

                this.logger.info(`     🔔 @提及策略: ${result} (概率: ${probability}, 随机值: ${Math.random().toFixed(2)})`);
                reasons.push(`@提及${result.includes("✅") ? "触发" : "未触发"}`);

                // 增加意愿值
                const increase = this.config.Advanced?.Willingness?.AtIncrease || 30;
                this.willingnessManager.increaseWillingness(channelId, increase);
                this.logger.info(`       ↳ 意愿值 +${increase}`);
            } else {
                this.logger.info(`     🔔 @提及策略: 未提及 (概率: ${probability})`);
            }
        }

        // 2. 阈值策略
        if (!shouldReply && strategies.Threshold.Enabled) {
            const willingness = this.willingnessManager.getWillingness(channelId);
            const threshold = strategies.Threshold.Value * 100; // 转换为百分比
            const willReply = willingness >= threshold;
            const result = willReply ? "✅ 触发" : "❌ 未触发";

            this.logger.info(`     📈 阈值策略: ${result} (意愿值: ${willingness.toFixed(1)}/${threshold})`);

            if (willReply) shouldReply = true;
            reasons.push(`阈值策略${result.includes("✅") ? "触发" : "未触发"}`);
        }

        // 3. 对话流策略
        if (!shouldReply && strategies.ConversationFlow.Enabled) {
            const analysis = await this.analyzeConversationFlow(ctx);
            const confidenceThreshold = strategies.ConversationFlow.ConfidenceThreshold;
            const willReply = analysis.confidence >= confidenceThreshold && analysis.shouldReply;
            const result = willReply ? "✅ 触发" : "❌ 未触发";

            this.logger.info(`     💬 对话流策略: ${result} (置信度: ${analysis.confidence.toFixed(2)}/${confidenceThreshold})`);

            if (willReply) shouldReply = true;
            reasons.push(`对话流策略${result.includes("✅") ? "触发" : "未触发"}`);
        }

        // 4. 关键词策略
        if (!shouldReply) {
            const hasKeyword = this.checkKeywords(ctx);
            const result = hasKeyword ? "✅ 触发" : "❌ 未触发";

            this.logger.info(`     🔑 关键词策略: ${result}`);

            if (hasKeyword) shouldReply = true;
            reasons.push(`关键词策略${result.includes("✅") ? "触发" : "未触发"}`);
        }

        // 增加基础意愿值
        if (!ctx.isMentioned) {
            const increase = this.config.Advanced?.Willingness?.MessageIncrease || 10;
            this.willingnessManager.increaseWillingness(channelId, increase);
            this.logger.info(`     📈 基础意愿值 +${increase}`);
        }

        // 汇总评估结果
        if (shouldReply) {
            this.logger.info(`   🎯 满足回复条件: ${reasons.join(" | ")}`);
        } else if (reasons.length > 0) {
            this.logger.info(`   🚫 不满足回复条件: ${reasons.join(" | ")}`);
        } else {
            this.logger.info(`   🚫 不满足回复条件: 无策略触发`);
        }

        return shouldReply;
    }

    /**
     * 分析对话流
     */
    private async analyzeConversationFlow(ctx: MiddlewareContext): Promise<ReplyDecision> {
        this.logger.info("     🧠 分析对话流...");
        const channelId = ctx.koishiSession.channelId;

        // 构建 ChatMessage 对象
        const message: ChatMessage = {
            messageId: ctx.koishiSession.messageId,
            content: ctx.koishiSession.content,
            sender: {
                id: ctx.koishiSession.userId,
                name: ctx.koishiSession.author?.name || ctx.koishiSession.author?.nick || "未知用户"
            },
            timestamp: new Date(ctx.koishiSession.timestamp),
            channel: {
                id: ctx.koishiSession.channelId,
                type: getChannelType(ctx.koishiSession.channelId)
            }
        };

        // 分析消息并获取分析结果
        await this.flowAnalyzer.analyzeMessage(channelId, message);

        const analysis = this.flowAnalyzer.shouldReply(channelId, message);

        // 记录详细分析结果
        this.logger.info(`       ↳ 回复建议: ${analysis.shouldReply}`);
        this.logger.info(`       ↳ 原因: ${analysis.reason}`);
        this.logger.info(`       ↳ 置信度: ${analysis.confidence.toFixed(2)}`);

        return analysis;
    }

    /**
     * 检查关键词
     */
    private checkKeywords(ctx: MiddlewareContext): boolean {
        const keywords = this.config.Advanced?.Willingness?.Keywords;
        if (!keywords || !keywords.List.length) {
            this.logger.info("     🔑 关键词策略: 未配置");
            return false;
        }

        const content = ctx.koishiSession.content.toLowerCase();
        const matchedKeywords = keywords.List.filter(keyword => content.includes(keyword.toLowerCase()));

        if (matchedKeywords.length > 0) {
            const increase = keywords.Increase || 10;
            this.willingnessManager.increaseWillingness(ctx.koishiSession.channelId, increase * matchedKeywords.length);
            this.logger.info(`     🔑 关键词策略: ✅ 匹配到关键词: ${matchedKeywords.join(", ")}`);
            this.logger.info(`       ↳ 意愿值 +${increase * matchedKeywords.length}`);
            return true;
        }

        this.logger.info("     🔑 关键词策略: ❌ 无匹配关键词");
        return false;
    }

    /**
     * 获取意愿值统计
     */
    getWillingnessStats(): Record<string, number> {
        const stats: Record<string, number> = {};
        for (const [channelId, willingness] of this.willingnessManager["willingnessMap"]) {
            stats[channelId] = willingness;
        }
        return stats;
    }

    /**
     * 健康检查
     */
    async healthCheck(): Promise<boolean> {
        // 检查配置是否有效
        return this.config.Channels.length > 0;
    }
}
