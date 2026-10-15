import { Universal, type Bot, type Session } from "koishi";

import type { DurableTask } from "./store";

export interface DeliveryRuntime {
    bots: readonly Bot[];
    filter(session: Session): boolean;
    world: {
        stimulusOwnerId: string;
        isChannelAllowed(session: Session): boolean;
        isBotMuted(cid: string, selfId: string): boolean;
    };
    rules(task: DurableTask): Promise<Array<{ blocked: string[]; expiresAt: number | null }>>;
}
export function currentTargetAllowed(runtime: DeliveryRuntime, session: Session, ownerId: string): boolean {
    return (
        runtime.world.stimulusOwnerId === ownerId &&
        runtime.bots.some((bot) => bot.platform === session.platform && bot.selfId === session.selfId && bot.status === Universal.Status.ONLINE) &&
        runtime.filter(session) &&
        runtime.world.isChannelAllowed(session) &&
        !runtime.world.isBotMuted(session.cid, session.selfId)
    );
}
export async function prepareDelivery(
    runtime: DeliveryRuntime,
    task: DurableTask,
    ownerId: string,
): Promise<{ session: Session; ownerId: string } | { error: string }> {
    if (runtime.world.stimulusOwnerId !== ownerId) return { error: "core_owner_changed" };
    const bot = runtime.bots.find((item) => item.platform === task.platform && item.selfId === task.selfId);
    if (!bot || bot.status !== Universal.Status.ONLINE) return { error: "bot_unavailable" };
    try {
        // 只读地重新解析频道；无法核验的适配器不恢复发送权限。
        const channel = await bot.getChannel(task.channelId, task.guildId || undefined);
        if (channel?.id !== task.channelId || (channel.type === Universal.Channel.Type.DIRECT) !== task.isDirect) return { error: "channel_not_verified" };
        // Koishi adapters create the richer framework Session at runtime.
        const session = bot.session({
            type: "internal",
            platform: task.platform,
            selfId: task.selfId,
            user: { id: task.requester },
            channel,
            ...(task.guildId ? { guild: { id: task.guildId } } : {}),
        }) as unknown as Session;
        if (!currentTargetAllowed(runtime, session, ownerId)) return { error: "channel_not_allowed" };
        const rules = await runtime.rules(task);
        if (
            rules.some(
                (rule) =>
                    (rule.expiresAt === null || rule.expiresAt > Date.now()) && rule.blocked.some((category) => category === "all" || category === "scheduled"),
            )
        )
            return { error: "reply_suppressed" };
        if (!currentTargetAllowed(runtime, session, ownerId)) return { error: "channel_not_allowed" };
        return { session, ownerId };
    } catch {
        return { error: "channel_not_verified" };
    }
}
