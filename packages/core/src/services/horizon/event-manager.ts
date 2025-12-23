import type { Context, Query } from "koishi";
import type { HistoryConfig } from "./config";
import type { MessageRecord, Observation, Scope, TimelineEntry } from "./types";
import type { PromptFormatConfig } from "@/services/prompt";
import { TableName } from "@/shared/constants";
import { ToonParser } from "@/shared/utils";
import { TimelineEventType, TimelinePriority, TimelineStage } from "./types";

interface EventQueryOptions {
    scope: Query.Expr<Scope>;
    types?: TimelineEventType[];
    stage?: TimelineStage | TimelineStage[];
    limit?: number;
    since?: Date;
    until?: Date;
    orderBy?: "asc" | "desc";
}

export class EventManager {
    constructor(
        private ctx: Context,
        private config: HistoryConfig & PromptFormatConfig,
    ) {}

    // -------- 写入 --------
    public async record(entry: TimelineEntry): Promise<TimelineEntry> {
        let data = entry.data;
        // 确保存入数据库的是字符串
        if (typeof data === "object") {
            data = JSON.stringify(data);
        }

        const result = (await this.ctx.database.create(TableName.Timeline, {
            ...entry,
            data,
        } as any)) as TimelineEntry;

        // 返回原始对象数据，方便调用者直接使用
        return { ...result, data: entry.data } as TimelineEntry;
    }

    // -------- 查询 --------
    public async query(options: EventQueryOptions): Promise<TimelineEntry[]> {
        const query: Query.Expr<TimelineEntry> = {};

        if (options.scope) {
            query.scope = options.scope;
        }

        if (options.types && options.types.length > 0) {
            // @ts-expect-error typing check
            query.type = { $in: options.types };
        }

        if (options.stage) {
            if (Array.isArray(options.stage)) {
                // @ts-expect-error typing check
                query.stage = { $in: options.stage };
            } else {
                query.stage = options.stage;
            }
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

        const results = (await dbQuery.execute()) as TimelineEntry[];
        return results.map((entry) => {
            if (typeof entry.data === "string") {
                // 即使 format 是 toon，如果数据看起来像 JSON，也应该尝试解析
                // 这样可以兼容旧数据，并正确处理被标记为 toon 但实际存的是 JSON 的消息记录
                const trimmed = entry.data.trim();
                const isJson = trimmed.startsWith("{") || trimmed.startsWith("[");

                if (isJson) {
                    try {
                        entry.data = JSON.parse(entry.data);
                    } catch (e) {
                        // 解析失败则保持原样
                    }
                } else if (entry.format === "toon") {
                    // 如果是 toon 格式，尝试解析
                    if (entry.type === TimelineEventType.Message) {
                        // 解析消息类型
                        const lines = (entry.data as string).split("\n");
                        const data: any = {};
                        for (const line of lines) {
                            const colonIndex = line.indexOf(":");
                            if (colonIndex !== -1) {
                                const key = line.substring(0, colonIndex).trim();
                                let value = line.substring(colonIndex + 1).trim();
                                if (key === "+ message") continue;
                                if (value.startsWith('"') && value.endsWith('"')) {
                                    try {
                                        value = JSON.parse(value);
                                    } catch {}
                                }
                                data[key] = value;
                            }
                        }
                        entry.data = data;
                    } else if (!(entry.data as string).includes("+ thoughts:") && !(entry.data as string).includes("+ actions:")) {
                        // 可能是通用对象，尝试 parseSimple
                        entry.data = ToonParser.parseSimple(entry.data as string) as any;
                    }
                }
            }
            return entry;
        });
    }

    // -------- 视图转换 --------
    public toObservations(entries: TimelineEntry[]): Observation[] {
        const observations: Observation[] = [];
        for (const entry of entries) {
            switch (entry.type) {
                case TimelineEventType.Message:
                    observations.push({
                        type: "message",
                        stage: entry.stage,
                        isMessage: true,
                        timestamp: entry.timestamp,
                        messageId: entry.data.messageId,
                        sender: {
                            type: "user",
                            id: entry.data.senderId,
                            name: entry.data.senderName,
                        },
                        content: entry.data.content,
                    });
                    break;
                case TimelineEventType.MemberJoin:
                case TimelineEventType.MemberLeave:
                case TimelineEventType.StateUpdate:
                case TimelineEventType.Reaction:
                    observations.push({
                        type: `notice.${entry.type.toLowerCase()}` as Observation["type"],
                        stage: entry.stage,
                        isNotice: true,
                        timestamp: entry.timestamp,
                    } as Observation);
                    break;
            }
        }
        return observations;
    }

    public async markAsActive(scope: Scope, before?: Date): Promise<void> {
        const query: Query<TimelineEntry> = {
            scope,
            stage: TimelineStage.New,
            timestamp: before ? { $lte: before } : undefined,
        };
        await this.ctx.database.set(TableName.Timeline, query, { stage: TimelineStage.Active });
    }

    public async recordMessage(message: Omit<MessageRecord, "type" | "priority">): Promise<MessageRecord> {
        const result = (await this.record({
            ...message,
            type: TimelineEventType.Message,
            priority: TimelinePriority.Normal,
        } as MessageRecord)) as MessageRecord;
        this.ctx.logger.debug(`${message.scope} ${message.data.senderId}: ${message.data.content}`);
        return result as MessageRecord;
    }

    public async clearWorkingMemory(scope: Scope) {
        const { AgentAction, AgentThought, AgentTool, ToolResult } = TimelineEventType;
        const query: Query<TimelineEntry> = {
            type: { $in: [AgentAction, AgentThought, AgentTool, ToolResult] },
            scope,
            stage: { $in: [TimelineStage.New, TimelineStage.Active] },
        } as unknown as Query<TimelineEntry>;
        await this.ctx.database.remove(TableName.Timeline, query);
    }

    public async clearHistory(scope: Scope) {
        const query: Query<TimelineEntry> = {
            scope,
            stage: { $in: [TimelineStage.New, TimelineStage.Active] },
        } as unknown as Query<TimelineEntry>;
        await this.ctx.database.remove(TableName.Timeline, query);
    }
}
