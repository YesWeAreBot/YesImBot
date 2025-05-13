import { Middleware,  ConversationState, MessageContext } from './base';
import { Context } from 'koishi';

export class ErrorHandlingMiddleware implements Middleware {
    name = 'error-handling';
    private logger: Context['logger'];

    constructor(logger: Context['logger']) { 
        this.logger = logger;
    }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        try {
            // 执行后续中间件
            await next();
        } catch (error) {
            // 记录错误日志
            this.logger.error(`Error in session ${ctx.koishiSession.id}:`, error.message);
            this.logger.error(`Error stack trace:`, error.stack);

            // 重置会话状态
            await ctx.transitionTo(ConversationState.IDLE);
        }
    }
}
