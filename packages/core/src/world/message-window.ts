import { $, type Context } from "koishi";

import { TableName } from "../shared/constants";
import { parseConversationChannelId } from "../shared/utils/conversation-scope";
import type { HistoryChannelType, MessageData } from "./types";

export interface MessageWindowOptions {
    messageId: string;
    before?: number;
    after?: number;
    offset?: number;
    limit?: number;
}

export interface MessageWindowTarget {
    platform: string;
    channelId: string;
    selfId: string;
    channelType: HistoryChannelType;
}

/** Evidence identity is original-source identity, never the recall call or page. */
function sourceRecord(record: MessageData) {
    // The raw table is shared across bots and has no persisted observer/self identity.
    const sourceIdentity = {
        platform: record.platform,
        ...parseConversationChannelId(record.platform, record.channelId),
        channelType: record.channelType!,
        messageId: record.id,
        ownership: "shared-history" as const,
    };
    return { ...record, sourceIdentity, evidenceKey: JSON.stringify([record.platform, record.channelId, record.channelType, record.id]) };
}

/** Caller holds the history barrier and validates live authorization before exposing results. */
export async function readMessageWindowPage(db: Context["database"], target: MessageWindowTarget, options: MessageWindowOptions) {
    const before = options.before ?? 5,
        after = options.after ?? 5,
        offset = options.offset ?? 0,
        limit = options.limit ?? 20;
    if (!target.platform || !target.channelId || !target.selfId || !["private", "guild"].includes(target.channelType)) throw new Error("消息窗口目标不完整");
    if (typeof options.messageId !== "string" || !options.messageId.trim()) throw new Error("消息窗口需要 messageId");
    if (![before, after].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 50)) throw new Error("消息窗口前后范围须为 0–50 条");
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20)
        throw new Error("消息窗口分页须为非负位置、1–20 条");
    // Explicit channel type prevents a reused platform channel ID from crossing private/group boundaries.
    const scope = { platform: target.platform, channelId: target.channelId, channelType: target.channelType };
    const anchors = await db.get(TableName.Messages, { ...scope, id: options.messageId }, { limit: 2 });
    if (!anchors.length) throw new Error("当前会话中消息不存在或不可访问");
    if (anchors.length !== 1) throw new Error("消息窗口锚点不唯一");
    const anchor = anchors[0];
    const earlier = { ...scope, $or: [{ timestamp: { $lt: anchor.timestamp } }, { timestamp: anchor.timestamp, id: { $lt: anchor.id } }] };
    const later = { ...scope, $or: [{ timestamp: { $gt: anchor.timestamp } }, { timestamp: anchor.timestamp, id: { $gt: anchor.id } }] };
    const [preceding, following, beforeCount, afterCount] = await Promise.all([
        db.get(TableName.Messages, earlier, { sort: { timestamp: "desc", id: "desc" }, limit: before }),
        db.get(TableName.Messages, later, { sort: { timestamp: "asc", id: "asc" }, limit: after }),
        db.eval(TableName.Messages, (r) => $.count(r.id), earlier),
        db.eval(TableName.Messages, (r) => $.count(r.id), later),
    ]);
    const window = [...preceding.reverse(), anchor, ...following];
    const records = window.slice(offset, offset + limit).map((r) => sourceRecord(r));
    // Anchor quotes remain available even on pages that do not include the anchor.
    const quoteSources = [...new Map([anchor, ...records].map((r) => [r.id, r])).values()].filter((r) => r.quoteId);
    const quoteIds = [...new Set(quoteSources.map((r) => r.quoteId!))];
    const quoted = quoteIds.length ? await db.get(TableName.Messages, { ...scope, id: { $in: quoteIds } }) : [];
    for (const record of [...window, ...quoted]) {
        if (record.platform !== target.platform || record.channelId !== target.channelId || record.channelType !== target.channelType)
            throw new Error("数据库返回了范围外的消息");
    }
    const quotes = quoteSources.map((r) => {
        const matches = quoted.filter((q) => q.id === r.quoteId);
        if (matches.length > 1) throw new Error("引用消息不唯一");
        return { messageId: r.id, quoteId: r.quoteId!, missing: !matches.length, ...(matches.length ? { record: sourceRecord(matches[0]) } : {}) };
    });
    return {
        kind: "message-window" as const,
        target: { ...target },
        anchorId: anchor.id,
        anchor: sourceRecord(anchor),
        records,
        quotes,
        before: {
            available: beforeCount,
            selected: preceding.length,
            hasMore: beforeCount > preceding.length,
            nextAnchorId: beforeCount > preceding.length ? window[0].id : null,
        },
        after: {
            available: afterCount,
            selected: following.length,
            hasMore: afterCount > following.length,
            nextAnchorId: afterCount > following.length ? window[window.length - 1].id : null,
        },
        total: window.length,
        offset,
        returned: records.length,
        hasMore: offset + records.length < window.length,
        nextOffset: offset + records.length < window.length ? offset + records.length : null,
        previousOffset: offset > 0 ? Math.max(0, offset - limit) : null,
        contentTruncated: false as const,
        projection: { kind: "recalled" as const, isNewEvidence: false as const },
    };
}
