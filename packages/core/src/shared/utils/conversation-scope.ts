/** Adapter channel IDs may be local to their guild (Telegram forum topics). */
export interface ConversationSession {
    platform: string;
    channelId?: string;
    guildId?: string;
    isDirect?: boolean;
}

const TELEGRAM_TOPIC_PREFIX = "telegram-topic:";

/** Internal storage identity only. Never replace the adapter session's channelId. */
export function conversationChannelId(session: ConversationSession): string | undefined {
    const { platform, channelId, guildId, isDirect } = session;
    if (platform === "telegram" && !isDirect && guildId && channelId && channelId !== guildId)
        return TELEGRAM_TOPIC_PREFIX + JSON.stringify([guildId, channelId]);
    return channelId;
}

export function conversationCid(session: ConversationSession): string {
    return `${session.platform}:${conversationChannelId(session) ?? ""}`;
}

/** Decode internal identity when producing a transport target or source identity. */
export function parseConversationChannelId(platform: string, channelId: string): { channelId: string; guildId?: string } {
    if (platform === "telegram" && channelId.startsWith(TELEGRAM_TOPIC_PREFIX)) {
        try {
            const value: unknown = JSON.parse(channelId.slice(TELEGRAM_TOPIC_PREFIX.length));
            if (Array.isArray(value) && value.length === 2 && value.every((id) => typeof id === "string" && id.length > 0))
                return { guildId: value[0], channelId: value[1] };
        } catch {
            /* An unrecognized ID remains native. */
        }
    }
    return { channelId };
}
