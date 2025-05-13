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
    }) { }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        // 只在空闲状态下执行
        if (ctx.state !== ConversationState.IDLE) {
            return await next();
        }
        const logger = ctx.koishiContext.logger;
        const session = ctx.koishiSession;
        const author = session.author;

        let currentThreshold = this.currentThreshold.get(session.channelId) || 0;

        // 增加意愿值
        currentThreshold += this.options.increaseWillingnessOn.message;
        this.currentThreshold.set(session.channelId, currentThreshold);

        // 忽略机器人消息
        if (author.isBot) return;

        // 忽略非指定频道的消息
        if (!this.options.allowedChannels.includes(session.channelId)) return;

        const shouldReactToAt = Random.bool(this.options.atReactPossibility);
        const isThresholdReached = currentThreshold >= this.options.threshold;
        const shouldReply = (ctx.isMentioned && shouldReactToAt) || isThresholdReached || this.options.testMode;

        logger.info(`当前意愿值：${currentThreshold}, 是否达到回复条件：${shouldReply}`);

        if (shouldReply) {
            ctx.state = ConversationState.PROCESSING;
            // 继续处理链
            await next();
        } else {
            return;
        }

        // 重置意愿值
        this.currentThreshold.set(session.channelId, 0);
    }

}