import { Random } from "koishi";
import { ConversationState, MessageContext, Middleware } from "./base";


// 检查是否达到回复条件
export class CheckReplyConditionMiddleware implements Middleware {
    name = 'check-reply-condition';

    /**
     * 回复意愿，上限为 100
     * 
     * 下列行为会增加意愿值：
     * - 收到消息
     * - 收到 @ 消息
     * - 收到 @ 消息且满足回复条件
     * 
     * 意愿值超过阈值时触发回复
     * 
     * 回复后，意愿值会重置为 0
     */
    private currentThreshold = new Map<string, number>();

    // 当前频道处理状态 (channelId -> 是否正在处理)
    private channelProcessingState = new Map<string, boolean>();
    // 延迟处理定时器 (channelId -> 定时器)
    private delayTimers = new Map<string, NodeJS.Timeout>();
    // 最近发送消息的用户 (channelId -> {userId, timestamp})
    private lastMessageSenders = new Map<string, { userId: string, timestamp: number }>();

    constructor(private options: {
        allowedChannels: string[],
        // 测试模式，每条消息都会触发回复
        testMode: boolean,
        // at回复概率
        atReactPossibility: number,
        increaseWillingnessOn: {
            // 收到消息
            message: number,
            // 收到 @ 消息
            at: number,
        }
        // 回复阈值
        threshold: number,
        // 消息等待时间(毫秒)
        messageWaitTime: number;
        // 判定为同一用户连续消息的时间阈值(毫秒)
        sameUserThreshold: number;
    }) { }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        const channelId = ctx.koishiSession.channelId;
        const userId = ctx.koishiSession.author.id;

        // 忽略机器人消息
        if (ctx.koishiSession.author.isBot) return;

        // 忽略非指定频道的消息
        if (!this.options.allowedChannels.includes(ctx.koishiSession.channelId)) return;

        // 如果当前频道已有处理任务，则忽略新的触发条件
        if (this.channelProcessingState.get(channelId)) return;

        let currentThreshold = this.currentThreshold.get(channelId) || 0;
        // 增加意愿值
        currentThreshold += this.options.increaseWillingnessOn.message;
        this.currentThreshold.set(channelId, currentThreshold);

        // 处理延迟逻辑
        const lastSender = this.lastMessageSenders.get(channelId);
        const now = Date.now();

        // 更新最近发送消息的用户信息
        this.lastMessageSenders.set(channelId, { userId, timestamp: now });

        // 如果有未完成的定时器，且是同一用户在阈值时间内的消息，则取消之前的定时器
        if (this.delayTimers.has(channelId) &&
            lastSender &&
            lastSender.userId === userId &&
            now - lastSender.timestamp < this.options.sameUserThreshold) {

            clearTimeout(this.delayTimers.get(channelId));
        }

        // 设置新的定时器
        const timer = setTimeout(() => {
            this.processMessages(ctx, next);
        }, this.options.messageWaitTime);

        this.delayTimers.set(channelId, timer);
    }

    private async processMessages(ctx: MessageContext, next: () => Promise<void>) {
        const channelId = ctx.koishiSession.channelId;

        // 清除定时器
        this.delayTimers.delete(channelId);

        // 检查是否满足回复条件
        let currentThreshold = this.currentThreshold.get(channelId) || 0;
        const shouldReactToAt = Random.bool(this.options.atReactPossibility);
        const isThresholdReached = currentThreshold >= this.options.threshold;
        const shouldReply = (ctx.isMentioned && shouldReactToAt) ||
            isThresholdReached ||
            this.options.testMode;

        ctx.koishiContext.logger.info(`[CheckReplyCondition] channelId: ${channelId}, currentThreshold: ${currentThreshold}, shouldReactToAt: ${shouldReactToAt}, isThresholdReached: ${isThresholdReached}, shouldReply: ${shouldReply}`);

        if (shouldReply) {
            // 标记频道为正在处理状态
            this.channelProcessingState.set(channelId, true);

            // 设置状态为处理中并继续中间件链
            ctx.state = ConversationState.PROCESSING;
            await next();

            // 重置意愿值
            this.currentThreshold.set(channelId, 0);
        }
    }

    // 提供一个方法供LLMHandlingMiddleware调用，用于释放频道处理状态
    releaseChannelState(channelId: string) {
        this.channelProcessingState.set(channelId, false);
    }
}
