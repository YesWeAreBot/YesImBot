import type { Context, Session } from "koishi";

function parseIsoTime(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
        throw new Error("时间应为带时区的 ISO 格式，例如 2026-09-30T12:00:00Z。");
    return Date.parse(value);
}

export function registerDecisionCommands(
    ctx: Context,
    query: (session: Session) => string,
    history?: (session: Session, filter: { limit: number; from?: number; to?: number; traceId?: string }) => Promise<string>,
): void {
    ctx.command("chat.decision", "查看当前会话的最近回复决策", { authority: 3 }).action(({ session }) => {
        if (!session?.platform || !session.selfId || !session.channelId) return "请在目标群聊或私聊中执行指令。";
        return query(session);
    });
    if (!history) return;
    ctx.command("chat.decisions [limit:natural]", "查看当前会话的本地决策记录", { authority: 3 })
        .option("trace", "--trace <id:string> 精确筛选决策/回复轮 ID")
        .option("from", "--from <time:string> 开始时间，带时区的 ISO 时间")
        .option("to", "--to <time:string> 结束时间，带时区的 ISO 时间")
        .action(async ({ session, options }, limit = 10) => {
            if (!session?.platform || !session.selfId || !session.channelId) return "请在目标群聊或私聊中执行指令。";
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return "条数应为 1 到 100。";
            try {
                const from = parseIsoTime(options!.from as string | undefined);
                const to = parseIsoTime(options!.to as string | undefined);
                if (from !== undefined && to !== undefined && from > to) return "开始时间不能晚于结束时间。";
                const traceId = options?.trace;
                if (traceId !== undefined && (typeof traceId !== "string" || !traceId.length || traceId.length > 512 || /\p{Cc}/u.test(traceId)))
                    return "trace ID 应为 1 到 512 字符，且不能包含控制字符。";
                return await history(session, { limit, from, to, ...(traceId === undefined ? {} : { traceId }) });
            } catch (error) {
                return `查询失败：${error.message}`;
            }
        });
}
