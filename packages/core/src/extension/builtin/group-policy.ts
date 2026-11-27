import { Context, Schema, Session } from "koishi";

import { assertReplyTurn } from "../../agent/reply-turn";

export interface GroupPolicy {
    platform: string;
    selfId: string;
    guildId: string;
    actions: Array<"delmsg" | "ban" | "unban" | "kick" | "essence" | "poke">;
    userIds: string[];
    autonomous?: boolean;
}
export const groupPoliciesSchema: Schema<GroupPolicy[]> = Schema.array(
    Schema.object({
        platform: Schema.string().required(),
        selfId: Schema.string().required(),
        guildId: Schema.string().required(),
        actions: Schema.array(Schema.union(["delmsg", "ban", "unban", "kick", "essence", "poke"])).default([]),
        userIds: Schema.array(String).default([]).description("允许触发操作的用户 ID"),
        autonomous: Schema.boolean().default(false).description("明确授权此 Bot 在该群自主执行所选操作（不限制触发用户）"),
    }),
)
    .default([])
    .description("群副作用授权；默认拒绝，不允许跨群");

export function assertGroupAction(
    ctx: Context,
    policies: readonly GroupPolicy[] | undefined,
    session: Session,
    action: string,
    target: string,
    channel = false,
): void {
    assertReplyTurn();
    if (
        !session.platform ||
        !session.selfId ||
        !session.guildId ||
        !session.channelId ||
        session.isDirect ||
        target !== (channel ? session.channelId : session.guildId) ||
        (typeof ctx.filter === "function" && !ctx.filter(session)) ||
        (ctx.yesimbot?.world?.isChannelAllowed && !ctx.yesimbot.world.isChannelAllowed(session))
    ) {
        throw new Error("群操作仅限有效且已允许的当前群会话");
    }
    if (
        !policies?.some(
            (p) =>
                p.platform === session.platform &&
                p.selfId === session.selfId &&
                p.guildId === session.guildId &&
                p.actions.some((allowedAction) => allowedAction === action) &&
                (p.autonomous === true || p.userIds.includes(session.userId ?? "")),
        )
    ) {
        throw new Error("管理员尚未授权此主体、群组和操作");
    }
}

/** OneBot message IDs are global; passing a channel argument alone is not a scope check. */
export async function assertCurrentMessage(session: Session, messageId: string): Promise<void> {
    if (typeof messageId !== "string" || !messageId.trim()) throw new Error("Invalid message ID");
    if (messageId === session.messageId) return;
    const message = await session.bot.getMessage(session.channelId!, messageId);
    if (message?.id !== messageId || message.channel?.id !== session.channelId || (message.guild?.id && message.guild.id !== session.guildId))
        throw new Error("无法确认消息属于当前频道");
    assertReplyTurn();
}
