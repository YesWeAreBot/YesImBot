import type { Context } from "koishi";
import { TableName } from "../../shared/constants";
import { diaryDateKey } from "./memory-date";

export interface RawRecallOptions {
    kind?: "messages" | "l2" | "l3";
    query?: string;
    id?: string;
    start?: string;
    end?: string;
    userId?: string;
    offset?: number;
    limit?: number;
}

/** A page limits records, never the body of a selected record. */
export async function recallRawPage(db: Context["database"], target: { platform: string; channelId: string }, options: RawRecallOptions) {
    if (!target.platform || !target.channelId) throw new Error("召回目标不完整");
    const kind = options.kind ?? "l3", offset = options.offset ?? 0, limit = options.limit ?? 6;
    if (!["messages", "l2", "l3"].includes(kind)) throw new Error("未知记忆类型");
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("召回分页须为非负位置、1–20 条");
    if (options.query !== undefined && (typeof options.query !== "string" || options.query.length > 160)) throw new Error("关键词最长 160 字");
    const date = (value?: string) => {
        if (value === undefined) return undefined;
        const result = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
        if (/^\d{4}-\d{2}-\d{2}$/.test(value) && diaryDateKey(result) !== value) throw new Error("召回日期无效");
        return result;
    };
    const start = date(options.start), end = date(options.end);
    if (end && /^\d{4}-\d{2}-\d{2}$/.test(options.end ?? "")) end.setHours(23, 59, 59, 999);
    if ([start, end].some(d => d && !Number.isFinite(d.getTime())) || (start && end && start > end)) throw new Error("召回日期无效");
    const query: any = { platform: target.platform, channelId: target.channelId };
    if (options.id) query.id = options.id;
    if (options.query?.trim()) query.content = { $regex: new RegExp(options.query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") };
    if (options.userId) {
        if (kind === "messages") query.sender = { id: options.userId };
        else throw new Error("按用户 ID 检索请使用 messages；摘要人物筛选请使用 person_recall");
    }
    if (start || end) {
        if (kind === "l3") query.date = { ...(start ? { $gte: diaryDateKey(start) } : {}), ...(end ? { $lte: diaryDateKey(end) } : {}) };
        else if (kind === "messages") query.timestamp = { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) };
        else { if (start) query.endTimestamp = { $gte: start }; if (end) query.startTimestamp = { $lte: end }; }
    }
    const table = kind === "messages" ? TableName.Messages : kind === "l2" ? TableName.L2Chunks : TableName.L3Diaries;
    const sort: any = kind === "messages" ? { timestamp: "asc", id: "asc" } : kind === "l2" ? { startTimestamp: "asc", id: "asc" } : { date: "asc", id: "asc" };
    const l2Fields = ["id", "platform", "channelId", "content", "participantIds", "startTimestamp", "endTimestamp"] as const;
    const rows = kind === "l2"
        ? await db.get(TableName.L2Chunks, query, { sort, offset, limit: limit + 1, fields: [...l2Fields] })
        : await db.get(table, query, { sort, offset, limit: limit + 1 });
    const selected = rows.slice(0, limit).map(row => kind === "l2"
        ? Object.fromEntries(l2Fields.map(field => [field, row[field]])) as typeof row
        : row);
    if (selected.some(row => row.platform !== target.platform || row.channelId !== target.channelId)) throw new Error("数据库返回了范围外的记忆");
    return { kind, target: { platform: target.platform, channelId: target.channelId }, query: options.query ?? "", offset, returned: selected.length, hasMore: rows.length > limit,
        nextOffset: rows.length > limit ? offset + limit : null, contentTruncated: false as const, records: selected };
}
