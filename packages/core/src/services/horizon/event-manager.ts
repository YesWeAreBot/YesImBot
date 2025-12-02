import type { Context, Query } from "koishi";
import type { HistoryConfig } from "./config";
import type { MessageRecord, Observation, Scope, TimelineEntry } from "./types";
import { TableName } from "@/shared/constants";
import { TimelineEventType, TimelinePriority } from "./types";

interface EventQueryOptions {
    scope: Query.Expr<Scope>;
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

        if (options.scope) {
            query.scope = options.scope;
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
        const observations: Observation[] = [];
        for (const entry of entries) {
            switch (entry.eventType) {
                case TimelineEventType.Message:
                    observations.push({
                        type: "message",
                        isMessage: true,
                        timestamp: entry.timestamp,
                        messageId: entry.eventData.messageId,
                        sender: {
                            type: "user",
                            id: entry.eventData.senderId,
                            name: entry.eventData.senderName,
                        },
                        content: entry.eventData.content,
                    });
                    break;
                case TimelineEventType.MemberJoin:
                case TimelineEventType.MemberLeave:
                case TimelineEventType.StateUpdate:
                case TimelineEventType.Reaction:
                    observations.push({
                        type: `notice.${entry.eventType.toLowerCase()}` as Observation["type"],
                        isNotice: true,
                        timestamp: entry.timestamp,
                    } as Observation);
                    break;
            }
        }
        return observations;
    }

    public async recordMessage(message: Omit<MessageRecord, "eventType" | "priority">): Promise<MessageRecord> {
        const fullMessage: MessageRecord = {
            ...message,
            eventType: TimelineEventType.Message,
            priority: TimelinePriority.Normal,
        };
        const result = await this.ctx.database.create(TableName.Timeline, fullMessage);
        this.ctx.logger.debug(`${message.scope} ${message.eventData.senderId}: ${message.eventData.content}`);
        return result as MessageRecord;
    }
}
