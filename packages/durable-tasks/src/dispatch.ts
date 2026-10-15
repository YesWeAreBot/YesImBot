import { randomUUID } from "node:crypto";

import type { Session } from "koishi";

import type { DurableTask } from "./store";

export interface ReminderWorld {
    stimulusOwnerId: string;
    l2_manager: { getHistoryGeneration(target: { platform: string; channelId: string; channelType?: string }): number };
    recordSystemEvent(
        event: {
            id: string;
            platform: string;
            channelId: string;
            channelType: "private" | "guild";
            type: string;
            timestamp: Date;
            eventScope: string;
            botKey: string;
            message: string;
            payload: object;
        },
        generation: number,
    ): Promise<boolean>;
}
export type ReminderEmit = (
    session: Session,
    event: "agent/stimulus",
    stimulus: {
        type: "scheduled_task";
        session: Session;
        channelCid: string;
        priority: number;
        payload: { taskId: string };
    },
    ownerId: string,
) => void;

export async function dispatchReminder(
    world: ReminderWorld,
    emit: ReminderEmit,
    allowed: () => boolean | Promise<boolean>,
    session: Session,
    task: DurableTask,
    ownerId: string,
): Promise<void> {
    const target = { platform: task.platform, channelId: task.channelId, channelType: task.isDirect ? ("private" as const) : ("guild" as const) };
    const generation = world.l2_manager.getHistoryGeneration(target);
    const valid = () => world.stimulusOwnerId === ownerId && world.l2_manager.getHistoryGeneration(target) === generation;
    if (!(await allowed()) || !valid()) throw new Error("delivery_invalidated");
    const recorded = await world.recordSystemEvent(
        {
            id: `reminder_${randomUUID()}`,
            ...target,
            type: "scheduled-reminder",
            timestamp: new Date(),
            eventScope: "channel",
            botKey: JSON.stringify([task.platform, task.selfId]),
            message: task.content,
            payload: { taskId: task.id, requester: task.requester },
        },
        generation,
    );
    if (!recorded || !(await allowed()) || !valid()) throw new Error("delivery_invalidated");
    emit(session, "agent/stimulus", { type: "scheduled_task", session, channelCid: session.cid, priority: 5, payload: { taskId: task.id } }, ownerId);
}
