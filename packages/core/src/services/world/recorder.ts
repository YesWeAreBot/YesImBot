import type { Context, Query } from "koishi";
import type { HistoryConfig } from "./config";
import type { MessageRecord, TimelineEntry } from "./types";
import { TableName } from "@/shared/constants";
import { TimelineEventType, TimelinePriority } from "./types";

/**
 * 事件记录器
 */
export class EventRecorder {
    constructor(
        private ctx: Context,
        private config: HistoryConfig,
    ) {}

    public async record(entry: TimelineEntry): Promise<TimelineEntry> {
        return await this.ctx.database.create(TableName.Timeline, entry);
    }

    public async recordMessage(message: Omit<MessageRecord, "eventType" | "priority">): Promise<MessageRecord> {
        const fullMessage: MessageRecord = {
            ...message,
            eventType: TimelineEventType.Message,
            priority: TimelinePriority.Normal,
        };
        const result = await this.ctx.database.create(TableName.Timeline, fullMessage);
        this.ctx.logger.debug(`${message.scopeId} ${message.eventData.senderId}: ${message.eventData.content}`);
        return result as MessageRecord;
    }

    public async getMessages(
        scopeId: string,
        query?: Query.Expr<MessageRecord>,
        limit?: number,
    ): Promise<MessageRecord[]> {
        const finalQuery: Query.Expr<MessageRecord> = {
            $and: [{ scopeId }, { eventType: TimelineEventType.Message }, query || {}],
        };

        return (
            await this.ctx.database
                .select(TableName.Timeline)
                .where(finalQuery)
                .orderBy("timestamp", "desc")
                .limit(limit)
                .execute()
        ).reverse() as MessageRecord[];
    }
}
