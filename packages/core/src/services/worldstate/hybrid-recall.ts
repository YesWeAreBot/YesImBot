import type { Context } from "koishi";

import { TableName } from "../../shared/constants";
import type { MemoryChunkData } from "./types";

export interface RecallFilter {
    platform?: string;
    channelId?: string;
    k?: number;
    startTimestamp?: Date;
    endTimestamp?: Date;
}

export function recallTokens(query: string): string[] {
    const words =
        query
            .slice(-160)
            .toLocaleLowerCase()
            .match(/[\p{L}\p{N}]+/gu) || [];
    return [
        ...new Set(
            words.flatMap((word) =>
                /^[\u3400-\u9fff]+$/.test(word) && word.length > 2
                    ? [word, ...Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))]
                    : [word],
            ),
        ),
    ].slice(0, 24);
}

export function keywordRelevance(content: string, tokens: string[]): number {
    const text = content.toLocaleLowerCase();
    const total = tokens.reduce((sum, token) => sum + token.length, 0);
    return total ? tokens.reduce((sum, token) => sum + (text.includes(token) ? token.length : 0), 0) / total : 0;
}

export function withinRecallScope(row: MemoryChunkData, options: RecallFilter): boolean {
    const start = new Date(row.startTimestamp).getTime(),
        end = new Date(row.endTimestamp).getTime();
    return (
        (!options.platform || row.platform === options.platform) &&
        (!options.channelId || row.channelId === options.channelId) &&
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start <= end &&
        start >= (options.startTimestamp?.getTime() ?? 0) &&
        end <= (options.endTimestamp?.getTime() ?? Date.now())
    );
}

/** Only real stored messages can supply source fallback; no source or embedding is invented. */
export async function recallKeywordCandidates(db: Context["database"], query: string, options: RecallFilter): Promise<MemoryChunkData[]> {
    const tokens = recallTokens(query);
    if (!options.platform || !options.channelId || !tokens.length) return [];
    const pattern = new RegExp(tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
    const target = { platform: options.platform, channelId: options.channelId, content: { $regex: pattern } };
    const [chunks, messages] = await Promise.all([
        db.get(
            TableName.L2Chunks,
            { ...target, startTimestamp: { $gte: options.startTimestamp ?? new Date(0) }, endTimestamp: { $lte: options.endTimestamp ?? new Date() } },
            { limit: 50, sort: { endTimestamp: "desc" } },
        ),
        db.get(
            TableName.Messages,
            { ...target, timestamp: { $gte: options.startTimestamp ?? new Date(0), $lte: options.endTimestamp ?? new Date() } },
            { limit: 50, sort: { timestamp: "desc" } },
        ),
    ]);
    return [
        ...chunks.slice(0, 50),
        ...messages
            .slice(0, 50)
            .filter((row) => row.id && row.sender?.id && typeof row.content === "string")
            .map((row) => ({
                id: `message:${row.id}`,
                platform: row.platform,
                channelId: row.channelId,
                content: `${row.sender.name || row.sender.id}: ${row.content}`,
                embedding: [],
                participantIds: [row.sender.id],
                startTimestamp: row.timestamp,
                endTimestamp: row.timestamp,
            })),
    ].filter((row) => withinRecallScope(row, options) && typeof row.content === "string" && keywordRelevance(row.content, tokens) > 0);
}
