import type { Session } from "koishi";

/** Matches an explicit mention of this bot, without treating other users or @all as the bot. */
export function isBotMention(session?: Session | null): boolean {
    if (session?.stripped?.atSelf) return true;
    const selfIds = [session?.bot?.selfId, session?.selfId].filter((id) => id != null && String(id) !== "");
    return !!session?.elements?.some(
        (element) => element?.type === "at" && element.attrs?.id != null && selfIds.some((id) => String(element.attrs.id) === String(id)),
    );
}
