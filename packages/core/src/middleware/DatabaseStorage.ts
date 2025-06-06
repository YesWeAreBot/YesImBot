import { Context, Element, h } from "koishi";
import { ScenarioManager } from "../services/ScenarioManager";
import { ChatMessage, MESSAGE_TABLE } from "../types/model";
import { getChannelType } from "../utils";
import { ImageProcessor } from "../utils/imageProcessor";
import { MessageContext, Middleware } from "./base";

/**
 * 数据库存储中间件
 */
export class DatabaseStorageMiddleware extends Middleware {
    constructor(protected ctx: Context, protected services: { imageProcessor: ImageProcessor; scenarioManager: ScenarioManager }) {
        super("database-storage", ctx, services, null);
    }

    async execute(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
        const elements = ctx.koishiSession.elements;
        const processedElements: Element[] = [];
        for await (const element of elements) {
            switch (element.type) {
                case "text":
                    processedElements.push(element);
                    break;
                case "image":
                case "img":
                    const imageData = await this.services.imageProcessor.process(element);
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

        // 如果消息成功保存，则通知 ScenarioManager 更新缓存中的 Scenario 实例
        if (newMessage) {
            await this.services.scenarioManager.updateMessage(newMessage, ctx.koishiSession, true);
        }

        // 继续处理链
        await next();
    }

    private async saveReceivedMessage(ctx: MessageContext, content: string): Promise<ChatMessage | null> {
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
            this.ctx.logger.info(`Message Received: ${content}`);
            return message;
        }
        return null;
    }
}
