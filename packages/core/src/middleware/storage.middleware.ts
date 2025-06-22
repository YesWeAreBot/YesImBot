import { Context, Element, h } from "koishi";
import { DataManager } from "../services";
import { ChatMessage, ImageProcessor, MESSAGE_TABLE, getChannelType } from "../shared";
import { BaseMiddleware, MiddlewareContext } from "./base";


export interface DatabaseStorageConfig {
    Debug?: boolean;
}

/**
 * 数据库存储中间件
 */
export class DatabaseStorageMiddleware extends BaseMiddleware<DatabaseStorageConfig> {
    private dataManager: DataManager;
    private imageProcessor: ImageProcessor;


    constructor(protected ctx: Context, config: DatabaseStorageConfig) {
        super("database-storage", ctx);
        this.dataManager = this.ctx.get("yesimbot.data");
        this.imageProcessor = this.ctx.get("yesimbot.imageProcessor");
    }

    async execute(ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> {
        const elements = ctx.koishiSession.elements;
        const processedElements: Element[] = [];
        for await (const element of elements) {
            switch (element.type) {
                case "text":
                    processedElements.push(element);
                    break;
                case "image":
                case "img":
                    const imageData = await this.imageProcessor.process(element);
                    if (imageData) {
                        processedElements.push(
                            h("img", { id: imageData.id, summary: element.attrs.summary, desc: imageData.desc || null })
                        );
                    } else {
                        processedElements.push(element);
                    }
                    break;
                case "at":
                    processedElements.push(element);
                    break;
                case "video":
                    processedElements.push(element);
                    break;
                default:
                    processedElements.push(element);
                    break;
            }
        }

        if (ctx.koishiSession.quote) processedElements.unshift(h.quote(ctx.koishiSession.quote.id));

        const content = processedElements.join("");

        // 保存接收到的消息
        const newMessage = await this.saveReceivedMessage(ctx, content);

        // 如果消息成功保存，并且我们正处于一个回合中，则更新世界状态
        if (newMessage && ctx.currentTurnId) {
            await this.dataManager.touchChannel(ctx.koishiSession);
            await this.dataManager.addMessageEvent(ctx.currentTurnId, ctx.koishiSession);
        }

        // 继续处理链
        await next();
    }

    private async saveReceivedMessage(ctx: MiddlewareContext, content: string): Promise<ChatMessage | null> {
        const session = ctx.koishiSession;
        // 检查消息是否已存在，防止重复存储
        const messages = await this.ctx.database.get(MESSAGE_TABLE, {
            messageId: session.messageId,
            channel: {
                id: session.channelId,
            },
        });
        if (messages.length === 0) {
            const message: ChatMessage = {
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
                    type: getChannelType(session.channelId),
                },
                timestamp: new Date(session.timestamp),
            };
            await this.ctx.database.create(MESSAGE_TABLE, message);
			this.ctx.logger.info(`[DB] [${session.channelId}] [${session.author.id}] 收到消息: ${content.substring(0, 50)}${content.length > 50 ? "..." : ""}`);

            return message;
        }
        return null;
    }

}