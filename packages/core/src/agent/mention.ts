import type { Session } from "koishi";

import { readOneBotMarkdownMention } from "../shared/utils/onebot-markdown";

/** Matches an explicit mention of this bot, without treating other users or @all as the bot. */
export function isBotMention(session?: Session | null): boolean {
    if (session?.stripped?.atSelf) return true;
    const selfIds = [session?.bot?.selfId, session?.selfId].filter((id) => id != null && String(id) !== "");
    const elements = session?.elements ?? [];
    if (elements.some((element) => element.type === "at" && selfIds.some((id) => String(element.attrs?.id) === String(id)))) return true;
    if (session?.platform !== "onebot") return false;
    return elements.some((element) => {
        if (element.type !== "markdown") return false;
        const mention = readOneBotMarkdownMention(element.attrs?.content);
        return !!mention && selfIds.some((id) => String(id) === mention[1]);
    });
}
