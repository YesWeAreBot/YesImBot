import { $, Context, h, Query } from "koishi";

import { TableName } from "@/shared/constants";
import { ChannelEventPayloadData, ContextualChannelEvent, ContextualMessage, EventData, L1HistoryItem, MessagePayload } from "./types";

export class HistoryManager {
    constructor(private ctx: Context) {}

    /**
     * 获取指定频道的 L1 线性历史记录
     * @param platform 平台
     * @param channelId 频道 ID
     * @param limit 检索的事件数量上限
     * @returns 按时间升序排列的 L1HistoryItem 数组
     */
    public async getL1History(platform: string, channelId: string, limit: number): Promise<L1HistoryItem[]> {
        const dbEvents = await this.getEventsByChannel(channelId, { end: new Date(), limit });

        const contextualDbEvents = dbEvents.map(this.eventDataToL1HistoryItem).filter(Boolean);

        const combined = [...contextualDbEvents];
        combined.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        combined.map((item: any, index) => {
            switch (item.type) {
                case "message":
                    item.is_user_message = true;
                    break;
                case "channel_event":
                    item.is_channel_event = true;
                    break;
            }
        });

        return combined.slice(-limit);
    }

    // 按时间范围查询所有事件
    public async getEventsByTime(options: { start?: Date; end?: Date; limit?: number } = {}): Promise<EventData[]> {
        const query: Query.Expr<EventData> = {
            timestamp: {},
        };
        if (options.start || options.end) {
            query.timestamp = {};
            if (options.start) query.timestamp.$gte = options.start;
            if (options.end) query.timestamp.$lt = options.end;
        }
        const events = (await this.ctx.database.get(TableName.Events, query, {
            limit: options.limit,
            sort: { timestamp: "desc" },
        })) as EventData[];
        return events;
    }

    // 获取频道内时间范围事件
    public async getEventsByChannel(channelId: string, options: { start?: Date; end?: Date; limit?: number } = {}): Promise<EventData[]> {
        const query: Query.Expr<EventData> = { channelId };
        if (options.start || options.end) {
            query.timestamp = {};
            if (options.start) query.timestamp.$gte = options.start;
            if (options.end) query.timestamp.$lt = options.end;
        }
        const events = (await this.ctx.database.get(TableName.Events, query, {
            limit: options.limit,
            sort: { timestamp: "desc" },
        })) as EventData[];
        return events;
    }

    // 获取频道内指定用户的事件
    /* prettier-ignore */
    public async getEventsByChannelAndUser(channelId: string, userId: string, options: { start?: Date; end?: Date; limit?: number } = {}): Promise<EventData[]> {
        // Koishi 的 JSON 查询尚不直接支持 payload.sender.id, 我们需要在内存中过滤
        const allChannelEvents = await this.getEventsByChannel(channelId, options);
        return allChannelEvents.filter((event) => (event.payload as MessagePayload)?.sender?.id === userId);
    }

    // 获取指定用户在所有聊天中的事件
    public async getEventsByUser(userId: string, options: { start?: Date; end?: Date; limit?: number } = {}): Promise<EventData[]> {
        const allEvents = await this.getEventsByTime(options);
        return allEvents.filter((event) => (event.payload as MessagePayload)?.sender?.id === userId);
    }

    public async getEventsBefore(timestamp: Date, limit: number, channelId?: string, userId?: string): Promise<EventData[]> {
        const options = { end: timestamp, limit };
        if (channelId && userId) {
            return this.getEventsByChannelAndUser(channelId, userId, options);
        } else if (channelId) {
            return this.getEventsByChannel(channelId, options);
        } else if (userId) {
            return this.getEventsByUser(userId, options);
        } else {
            return this.getEventsByTime(options);
        }
    }

    // 消息计数
    public async countNewMessages(channelId: string, options: { start: Date; end: Date; userId?: string }): Promise<number> {
        const query: Query.Expr<EventData> = {
            channelId,
            type: "message",
            timestamp: { $gte: options.start, $lt: options.end },
        };
        if (options.userId) {
            // 需要在内存中过滤
            const events = (await this.ctx.database.get(TableName.Events, query as any)) as EventData[];
            return events.filter((e) => (e.payload as MessagePayload)?.sender?.id === options.userId).length;
        }
        return this.ctx.database.eval(TableName.Events, (row) => $.count(row.id), query as any);
    }

    // 消息格式化
    public formatEventsToString(events: EventData[], options: { includeDetails?: boolean } = {}): string {
        return events
            .map((event) => {
                const time = event.timestamp.toLocaleTimeString();
                if (event.type === "message") {
                    const payload = event.payload as MessagePayload;
                    let base = `[${time}] ${payload.sender.name || payload.sender.id}: ${payload.content}`;
                    if (options.includeDetails) base += ` (ID: ${event.id})`;
                    return base;
                } else {
                    return `[${time}] System: ${(event.payload as ChannelEventPayloadData).message}`;
                }
            })
            .join("\n");
    }

    // 提取用户ID
    public getUniqueUserIds(events: EventData[]): string[] {
        const ids = new Set<string>();
        events.forEach((event) => {
            if (event.type === "message") {
                ids.add((event.payload as MessagePayload).sender.id);
            }
        });
        return Array.from(ids);
    }

    // 移除机器人消息
    public filterOutBotMessages(events: EventData[], botId: string): EventData[] {
        return events.filter((event) => (event.payload as MessagePayload)?.sender?.id !== botId);
    }

    private eventDataToL1HistoryItem(event: EventData): ContextualMessage | ContextualChannelEvent | null {
        if (event.type === "message") {
            return {
                type: "message",
                id: event.id,
                timestamp: event.timestamp,
                elements: h.parse((event.payload as MessagePayload).content),
                ...(event.payload as MessagePayload),
            } as ContextualMessage;
        }
        if (event.type === "channel_event") {
            return {
                type: "channel_event",
                id: event.id,
                timestamp: event.timestamp,
                ...(event.payload as ChannelEventPayloadData),
            } as ContextualChannelEvent;
        }
        return null;
    }
}
