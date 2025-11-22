import type { Context, Query } from "koishi";
import type { MessageRecord, TimelineEntry } from "./types";
import { TableName } from "@/shared/constants";
import { TimelineEventType, TimelinePriority } from "./types";

/**
 * 事件记录器
 */
export class EventRecorder {
    constructor(private ctx: Context) {}

    public async record(entry: TimelineEntry): Promise<TimelineEntry> {
        return await this.ctx.database.create(TableName.Timeline, entry);
    }

    public async recordMessage(message: Omit<MessageRecord, "eventType" | "priority">): Promise<MessageRecord> {
        const fullMessage: MessageRecord = {
            ...message,
            eventType: TimelineEventType.Message,
            priority: TimelinePriority.Normal,
        };
        return (await this.ctx.database.create(TableName.Timeline, fullMessage)) as MessageRecord;
    }

    public async getMessages(scopeId: string, query?: Query.Expr<MessageRecord>, limit?: number): Promise<MessageRecord[]> {
        const finalQuery: Query.Expr<MessageRecord> = {
            $and: [{ scopeId }, { eventType: TimelineEventType.Message }, query || {}],
        };

        return (await this.ctx.database
            .select(TableName.Timeline)
            .where(finalQuery)
            .orderBy("timestamp", "desc")
            .limit(limit)
            .execute()) as MessageRecord[];
    }
}
