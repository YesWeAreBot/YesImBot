import type { Context, Query } from "koishi";
import { Random } from "koishi";
import { MessageEventData, MessageRecord, TimelineEntry } from "./types";
import { TableName } from "@/shared/constants";

/**
 * 事件记录器
 */
export class EventRecorder {
    constructor(private ctx: Context) {}

    public async record(entry: TimelineEntry): Promise<TimelineEntry> {
        return await this.ctx.database.create(TableName.Timeline, entry);
    }

    public async recordMessage(message: Omit<MessageRecord, "eventType" | "eventCategory" | "priority">): Promise<MessageRecord> {
        const fullMessage: MessageRecord = {
            ...message,
            eventType: "user_message",
            eventCategory: "message",
            priority: 0,
        };
        return (await this.ctx.database.create(TableName.Timeline, fullMessage)) as MessageRecord;
    }

    public async getMessages(scopeId: string, query?: Query.Expr<MessageRecord>, limit?: number): Promise<MessageRecord[]> {
        const finalQuery: Query.Expr<MessageRecord> = {
            $and: [{ scopeId }, { eventCategory: "message" }, query || {}],
        };

        return (await this.ctx.database
            .select(TableName.Timeline)
            .where(finalQuery)
            .orderBy("timestamp", "desc")
            .limit(limit)
            .execute()) as MessageRecord[];
    }
}
