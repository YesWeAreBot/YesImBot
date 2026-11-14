import type { Command, Context, Session } from "koishi";

function parseIsoTime(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
        throw new Error("时间应为带时区的 ISO 格式，例如 2026-09-30T12:00:00Z。");
    return Date.parse(value);
}

const addHistoryFilters = <A extends unknown[]>(command: Command<never, never, A>) =>
    command
        .option("trace", "--trace <id:string> 精确筛选决策/回复轮 ID")
        .option("from", "--from <time:string> 开始时间，带时区的 ISO 时间")
        .option("to", "--to <time:string> 结束时间，带时区的 ISO 时间");

export function registerDecisionCommands(
    ctx: Context,
    query: (session: Session) => string,
    history?: (session: Session, filter: { limit: number; from?: number; to?: number; traceId?: string }) => Promise<string>,
): void {
    async function queryHistory(session: Session, options: { from?: string; to?: string; trace?: string }, limit = 10): Promise<string> {
        if (!history) return "当前未启用本地决策记录。";
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return "条数应为 1 到 100。";
        try {
            const from = parseIsoTime(options.from);
            const to = parseIsoTime(options.to);
            if (from !== undefined && to !== undefined && from > to) return "开始时间不能晚于结束时间。";
            const traceId = options.trace;
            if (traceId !== undefined && (typeof traceId !== "string" || !traceId.length || traceId.length > 512 || /\p{Cc}/u.test(traceId)))
                return "trace ID 应为 1 到 512 字符，且不能包含控制字符。";
            return await history(session, { limit, from, to, ...(traceId === undefined ? {} : { traceId }) });
        } catch (error) {
            return `查询失败：${error.message}`;
        }
    }

    addHistoryFilters(ctx.command("chat.decision [limit:natural]", "查看当前会话的回复决策", { authority: 3 }))
        .option("history", "--history 查询本地决策记录，默认最近 10 条")
        .action(({ session, options }, limit) => {
            if (!session?.platform || !session.selfId || !session.channelId) return "请在目标群聊或私聊中执行指令。";
            if (options?.history) return queryHistory(session, options, limit);
            if (limit !== undefined || options?.trace !== undefined || options?.from !== undefined || options?.to !== undefined)
                return "查询条数和筛选条件需要与 --history 一起使用。";
            return query(session);
        });

    if (!history) return;
    addHistoryFilters(ctx.command("chat.decisions [limit:natural]", "查看本地决策记录（也可用 chat.decision --history）", { authority: 3 })).action(
        ({ session, options }, limit) => {
            if (!session?.platform || !session.selfId || !session.channelId) return "请在目标群聊或私聊中执行指令。";
            return queryHistory(session, options ?? {}, limit);
        },
    );
}
