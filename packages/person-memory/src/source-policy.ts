import type { Context, Session } from "koishi";

import { sceneKey, type Evidence, type SceneInput } from "./store";

/** Rebuild only a source whose recorded scene proves its direct/group kind. */
export function summarySourceAllowed(
    ctx: Context,
    evidence: Evidence,
    scope: string,
    shared: boolean,
    current: (session: Session) => boolean,
    scopeOf: (session: Session) => string,
): boolean {
    try {
        const source = evidence.provenance;
        if (!source?.scene || !source.platform || !source.selfId || !source.channelId || !source.messageId) return false;
        let userId = evidence.userId;
        if (shared) {
            const account = JSON.parse(userId);
            if (!Array.isArray(account) || account.length !== 2 || account[0] !== source.platform || typeof account[1] !== "string" || !account[1])
                return false;
            userId = account[1];
        }
        if (!userId) return false;
        const bot = ctx.bots.find((bot) => bot.platform === source.platform && bot.selfId === source.selfId);
        if (!bot) return false;
        const candidates = [false, true].filter((isDirect) => {
            const input: SceneInput = { platform: source.platform, selfId: source.selfId, channelId: source.channelId, userId, isDirect };
            return sceneKey(input) === source.scene;
        });
        if (candidates.length !== 1) return false;
        const session = bot.session({
            type: "message",
            platform: source.platform,
            selfId: source.selfId,
            message: { id: source.messageId, content: evidence.text },
            channel: { id: source.channelId, type: candidates[0] ? 1 : 0 },
            ...(source.guildId ? { guild: { id: source.guildId } } : {}),
            user: { id: userId },
        });
        return (
            session.platform === source.platform &&
            session.selfId === source.selfId &&
            (!source.guildId || session.guildId === source.guildId) &&
            sceneKey({
                platform: session.platform,
                selfId: session.selfId,
                channelId: session.channelId || "",
                userId: session.userId || "",
                isDirect: session.isDirect,
            }) === source.scene &&
            scopeOf(session) === scope &&
            current(session)
        );
    } catch {
        return false;
    }
}
