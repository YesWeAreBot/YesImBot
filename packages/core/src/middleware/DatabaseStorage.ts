import { Context } from 'koishi';
import { MessageContext, Middleware } from './base';
import { Agent } from '../agent';

/**
 * 数据库存储中间件
 */
export class DatabaseStorageMiddleware implements Middleware {
    name = 'database-storage';

    constructor(private ctx: Context) { }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        // 在处理前保存接收到的消息
        await this.saveReceivedMessage(ctx);

        // 继续处理链
        await next();
    }

    private async saveReceivedMessage(ctx: MessageContext): Promise<void> {
        // 添加到数据库
        const messages = await this.ctx.database.get(Agent.MESSAGE_TABLE, {
            messageId: ctx.koishiSession.messageId,
            channel: {
                id: ctx.koishiSession.channelId,
            }
        });
        if (messages.length == 0) {
            await this.ctx.database.create(Agent.MESSAGE_TABLE, ctx.message);
            this.ctx.logger.info(`Message Received: ${ctx.koishiSession.content}`);
        }
    }
}
