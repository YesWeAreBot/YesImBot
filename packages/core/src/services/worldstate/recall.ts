import type { Context } from "koishi";
import { diaryDateKey } from "./memory-date";
import { TableName } from "../../shared/constants";
export interface StoredMemory {
    id: string;
    kind: "l2" | "l3";
    platform: string;
    channelId: string;
    content: string;
    participants: string[];
    timestamp: number;
    startedAt: number;
    score: number;
}
export interface StoredRecallOptions {
    query: string;
    targets: { platform: string; channelId: string }[];
    start?: number;
    end?: number;
    limit?: number;
    accept?: (item: StoredMemory) => boolean | Promise<boolean>;
}
/** Explicit, bounded old-memory lookup; it never broadens an empty target set. */
export async function recallStoredMemories(db: Context["database"], options: StoredRecallOptions): Promise<StoredMemory[]> {
    if (typeof options.query !== "string" || !options.query.trim() || options.query.length > 160)
        throw new Error("回忆关键词须为 1–160 字");
    if (
        [options.start, options.end].some((n) => n !== undefined && !Number.isFinite(n)) ||
        (options.start !== undefined && options.end !== undefined && options.start > options.end)
    )
        throw new Error("无效的回忆日期");
    const limit = Math.min(12, Math.max(1, Math.floor(options.limit ?? 6)));
    if (!Number.isFinite(limit)) throw new Error("无效的回忆数量");
    const words = options.query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    if (!words.length || !options.targets.length) return [];
    const tokens = [
        ...new Set(
            words.flatMap((w) =>
                /^[\u3400-\u9fff]+$/.test(w) && w.length > 2
                    ? [w, ...Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2))]
                    : [w]
            )
        ),
    ].slice(0, 24);
    const pattern = new RegExp(tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
    const result: StoredMemory[] = [],
        seen = new Set<string>();
    for (const target of options.targets.slice(0, 20)) {
        if (!target.platform || !target.channelId) throw new Error("回忆目标缺少平台或频道");
        const key = JSON.stringify([target.platform, target.channelId]);
        if (seen.has(key)) continue;
        seen.add(key);
        const query = { ...target, content: { $regex: pattern } };
        const [chunks, diaries] = await Promise.all([
            db.get(
                TableName.L2Chunks,
                {
                    ...query,
                    ...(options.start !== undefined ? { endTimestamp: { $gte: new Date(options.start) } } : {}),
                    ...(options.end !== undefined ? { startTimestamp: { $lte: new Date(options.end) } } : {}),
                },
                { limit: 50, sort: { endTimestamp: "desc" } }
            ),
            db.get(
                TableName.L3Diaries,
                {
                    ...query,
                    ...(options.start !== undefined || options.end !== undefined
                        ? {
                              date: {
                                  ...(options.start !== undefined ? { $gte: diaryDateKey(new Date(options.start)) } : {}),
                                  ...(options.end !== undefined ? { $lte: diaryDateKey(new Date(options.end)) } : {}),
                              },
                          }
                        : {}),
                },
                { limit: 50, sort: { date: "desc" } }
            ),
        ]);
        for (const entry of [
            ...chunks.map((c) => ({
                id: c.id,
                kind: "l2" as const,
                platform: c.platform,
                channelId: c.channelId,
                content: c.content,
                participants: c.participantIds || [],
                timestamp: new Date(c.endTimestamp).getTime(),
                startedAt: new Date(c.startTimestamp).getTime(),
            })),
            ...diaries.map((c) => ({
                id: c.id,
                kind: "l3" as const,
                platform: c.platform,
                channelId: c.channelId,
                content: c.content,
                participants: c.mentionedUserIds || [],
                timestamp: new Date(`${c.date}T23:59:59`).getTime(),
                startedAt: new Date(`${c.date}T00:00:00`).getTime(),
            })),
        ]) {
            // Driver and legacy rows are not trusted to broaden the target.
            if (entry.platform !== target.platform || entry.channelId !== target.channelId) continue;
            const content = entry.content.toLocaleLowerCase();
            const item = {
                ...entry,
                content: entry.content.slice(0, 4000),
                score: tokens.reduce((sum, token) => sum + (content.includes(token) ? token.length : 0), 0),
            };
            if (item.score && (!options.accept || (await options.accept(item)))) result.push(item);
        }
    }
    return result.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp).slice(0, limit);
}
