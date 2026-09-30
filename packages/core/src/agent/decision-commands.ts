import type { Context, Session } from "koishi";

export function registerDecisionCommands(ctx: Context, query: (session: Session) => string): void {
    ctx.command("chat.decision", "查看当前会话的最近回复决策", { authority: 3 }).action(({ session }) => {
        if (!session?.platform || !session.selfId || !session.channelId) return "请在目标群聊或私聊中执行指令。";
        return query(session);
    });
}
