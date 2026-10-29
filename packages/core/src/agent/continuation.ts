import type { Session } from "koishi";

import type { ConversationStateResult } from "../world/conversation-state";
import type { ContinuationConfig } from "./config";

export interface ContinuationMatch {
    mode: "trigger" | "willingness";
    revision: number;
    registeredAt: string;
    expiresAt: number;
    sourceMessageIds: string[];
}

/** A model-authored invitation, not an inference about the user's intent. */
export function matchContinuation(
    session: Session,
    config: ContinuationConfig | undefined,
    result: ConversationStateResult | undefined,
    now = Date.now(),
): ContinuationMatch | undefined {
    const state = result?.unknown === false ? result.state : undefined;
    const waiting = state?.followUp;
    if (!config?.enabled || !state || !waiting || !waiting.userIds.includes(session.userId!)) return;
    const registered = Date.parse(state.updatedAt);
    const duration = config.maxDurationSeconds;
    if (!Number.isFinite(registered) || !Number.isFinite(duration) || duration < 1) return;
    const expiresAt = Math.min(waiting.expiresAt, registered + duration * 1000);
    if (!Number.isFinite(expiresAt) || now < registered || now >= expiresAt || !state.sourceMessageIds.length) return;
    const otherMention = session.elements?.some((element) => element.type === "at" && element.attrs.id !== session.selfId);
    const otherQuote = session.quote?.user?.id && session.quote.user.id !== session.selfId;
    if (otherMention || otherQuote) return;
    return { mode: config.mode, revision: state.revision, registeredAt: state.updatedAt, expiresAt, sourceMessageIds: [...state.sourceMessageIds] };
}

export function sameContinuation(left: ContinuationMatch | undefined, right: ContinuationMatch | undefined): boolean {
    return !!left && !!right && JSON.stringify(left) === JSON.stringify(right);
}
