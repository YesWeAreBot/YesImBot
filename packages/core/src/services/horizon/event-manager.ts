import type { Context, Query } from "koishi";
import type { HistoryConfig } from "./config";
import type { MessageRecord, Observation, TimelineEntry } from "./types";
import { TableName } from "@/shared/constants";
import { TimelineEventType, TimelinePriority } from "./types";

interface EventQueryOptions {
    scopeId?: string;
    types?: string[];
    limit?: number;
    since?: Date;
    until?: Date;
    orderBy?: "asc" | "desc";
}

export class EventManager {
    constructor(
        private ctx: Context,
        private config: HistoryConfig,
    ) {}

    // -------- 写入 --------
    public async record(entry: TimelineEntry): Promise<TimelineEntry> {
        return this.ctx.database.create(TableName.Timeline, entry) as Promise<TimelineEntry>;
    }

    // -------- 查询 --------
    public async query(options: EventQueryOptions): Promise<TimelineEntry[]> {
        const query: Query.Expr<TimelineEntry> = {};

        if (options.scopeId) {
            query.scopeId = options.scopeId;
        }

        if (options.types && options.types.length > 0) {
            // @ts-expect-error typing check
            query.eventType = { $in: options.types };
        }

        if (options.since) {
            query.timestamp = { ...query.timestamp, $gte: options.since };
        }

        if (options.until) {
            query.timestamp = { ...query.timestamp, $lte: options.until };
        }

        let dbQuery = this.ctx.database.select(TableName.Timeline).where(query);

        if (options.orderBy) {
            dbQuery = dbQuery.orderBy("timestamp", options.orderBy);
        }

        if (options.limit) {
            dbQuery = dbQuery.limit(options.limit);
        }

        return dbQuery.execute() as Promise<TimelineEntry[]>;
    }

    // -------- 视图转换 --------
    public toObservations(entries: TimelineEntry[]): Observation[] {
        throw new Error("Method not implemented.");
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
