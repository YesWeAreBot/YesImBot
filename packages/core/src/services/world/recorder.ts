import type { Context, Query } from "koishi";

/**
 * 事件记录器
 */
export class EventRecorder {
    constructor(private ctx: Context) {}

    /* prettier-ignore */
    public async recordMessage(message: MessagePayload & { platform: string; channelId: string }): Promise<void> {
        await this.ctx.database.create(TableName.Events, {
            id: Random.id(),
            type: "message",
            timestamp: new Date(),
            platform: message.platform,
            channelId: message.channelId,
            // 提取查询优化字段
            senderId: message.sender.id,
            senderName: message.sender.name,
            payload: {
                id: message.id,
                sender: message.sender,
                content: message.content,
                quoteId: message.quoteId,
            },
        });
    }

    /* prettier-ignore */
    public async recordEvent(event: Omit<EventData, "id" | "type" | "timestamp"> & { type: "channel_event" | "global_event" }): Promise<void> {
        await this.ctx.database.create(TableName.Events, {
            id: Random.id(),
            type: event.type,
            timestamp: new Date(),
            platform: event.platform,
            channelId: event.channelId,
            // 提取查询优化字段
            eventType: (event.payload as ChannelEventPayloadData | GlobalEventPayloadData).eventType,
            payload: event.payload,
        });
    }

    /* prettier-ignore */
    public async recordChannelEvent(platform: string, channelId: string, eventPayload: ChannelEventPayloadData): Promise<void> {
        this.recordEvent({
            type: "channel_event",
            platform,
            channelId,
            payload: eventPayload,
        });
    }

    public async recordGlobalEvent(eventPayload: GlobalEventPayloadData): Promise<void> {
        this.recordEvent({
            type: "global_event",
            payload: eventPayload,
        });
    }
}
