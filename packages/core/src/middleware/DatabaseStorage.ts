import { Context, Element, h } from 'koishi';
import { MESSAGE_TABLE } from '../types/model';
import { getChannelType } from '../utils';
import { ImageProcessor } from '../utils/imageProcessor';
import { MessageContext, Middleware } from './base';


/**
 * 数据库存储中间件
 */
export class DatabaseStorageMiddleware implements Middleware {
    name = 'database-storage';

    constructor(private ctx: Context, private imageProcessor: ImageProcessor) { }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        const elements = ctx.koishiSession.elements;
        const processedElements: Element[] = [];
        for await (const element of elements) {
            switch (element.type) {
                case 'text':
                    processedElements.push(element);
                    break;

                case 'image':
                case 'img':
                    const imageData = await this.imageProcessor.process(element.attrs.src);
                    if (imageData) {
                        processedElements.push(h("img", { id: imageData.id, summary: imageData.summary, desc: imageData.desc }))
                    } else {
                        processedElements.push(element);
                    }
                    break;

                case 'at':
                    processedElements.push(element);
                    break;

                case 'video':
                    processedElements.push(element);
                    break;
                default:
                    processedElements.push(element);
                    break;
            }
        }
        const content = processedElements.join("");

        // 保存接收到的消息
        await this.saveReceivedMessage(ctx, content);

        // 继续处理链
        await next();
    }

    private async saveReceivedMessage(ctx: MessageContext, content: string): Promise<void> {
        const session = ctx.koishiSession;
        // 添加到数据库
        const messages = await this.ctx.database.get(MESSAGE_TABLE, {
            messageId: session.messageId,
            channel: {
                id: session.channelId,
            }
        });
        if (messages.length == 0) {
            await this.ctx.database.create(MESSAGE_TABLE, {
                messageId: session.messageId,
                content: content,
                sender: {
                    ...session.author,
                    id: session.author.id,
                    name: session.author.name,
                    nick: session.author.nick,
                },
                channel: {
                    id: session.channelId,
                    type: getChannelType(session.channelId)
                },
                timestamp: new Date(session.timestamp),
            });
            this.ctx.logger.info(`Message Received: ${content}`);
        }
    }
}
