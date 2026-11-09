import { conversationChannelId } from "../shared/utils/conversation-scope";
import { manualRecallOwners } from "../world/manual-recall";
import type { AgentStimulus, L1HistoryItem, WorldState } from "../world/types";

/** Identity-only routing metadata: never a model-inferred topic or user intention. */
export interface ConversationFocus {
    target: { platform: string; selfId: string; channelId: string };
    targetUserId?: string;
    triggerType: string;
    continuation?: import("./continuation").ContinuationMatch;
    continuationPolicy?: { mode: "trigger" | "willingness"; maxDurationSeconds: number };
    triggerMessageIds: string[];
    quoteMessageIds: string[];
    missingMessageIds: string[];
    sourceProvenance: "trusted_stimulus_and_current_target_l1";
    /** Tool-authored task state, not an inferred or verified statement about the user. */
    explicitWorkingState?: {
        unknown: boolean;
        revision?: number;
        topic?: string;
        openIssues?: string[];
        sourceMessageIds?: string[];
        followUp?: import("../world/conversation-state").FollowUpState;
        createdAt?: string;
        updatedAt?: string;
        sourceProvenance: "explicit_scoped_tool_state_not_verified_fact";
    };
}
export interface MemoryBudgetReport {
    budgetTokens: number;
    originalInputTokens: number;
    inputTokens: number;
    droppedEvents: number;
    droppedAgentTurns: number;
    droppedL2: number;
    droppedL3: number;
    protectedOverBudget: boolean;
    reason: string;
}
export type FocusedWorldState = WorldState & { conversationFocus?: ConversationFocus; memoryBudgetReport?: MemoryBudgetReport };

export function deriveConversationFocus(stimulus: AgentStimulus<any>, world: WorldState): ConversationFocus {
    const session = stimulus.session;
    const ids =
        stimulus.type === "user_message" && Array.isArray(stimulus.payload?.messageIds)
            ? [...new Set<string>(stimulus.payload.messageIds.filter((id: unknown): id is string => typeof id === "string" && !!id))]
            : stimulus.type === "background_task_completion" && session.messageId
              ? [session.messageId]
              : [];
    const messages = [...world.l1_working_memory.processed_events, ...world.l1_working_memory.new_events].filter((item) => item.type === "message");
    const quotes = [...new Set(messages.filter((item) => ids.includes(item.id)).flatMap((item) => (item.quoteId ? [item.quoteId] : [])))];
    const present = new Set(messages.map((item) => item.id));
    return {
        target: { platform: session.platform, selfId: session.selfId, channelId: conversationChannelId(session)! },
        targetUserId: session.userId,
        triggerType: stimulus.type,
        triggerMessageIds: ids,
        quoteMessageIds: quotes,
        missingMessageIds: [...ids, ...quotes].filter((id) => !present.has(id)),
        sourceProvenance: "trusted_stimulus_and_current_target_l1",
    };
}

/** A disposable projection; the source objects/arrays and raw store are never edited. */
export async function packWorldState(
    world: WorldState,
    options: {
        budgetTokens: number;
        focus: ConversationFocus;
        estimate: (world: WorldState) => Promise<number>;
    },
): Promise<{ worldState: WorldState; report: MemoryBudgetReport }> {
    const original = await options.estimate(world);
    const report: MemoryBudgetReport = {
        budgetTokens: options.budgetTokens,
        originalInputTokens: original,
        inputTokens: original,
        droppedEvents: 0,
        droppedAgentTurns: 0,
        droppedL2: 0,
        droppedL3: 0,
        protectedOverBudget: false,
        reason: "within_soft_budget",
    };
    if (!(options.budgetTokens > 0) || !Number.isFinite(options.budgetTokens)) {
        report.reason = "soft_budget_disabled";
        return { worldState: world, report };
    }
    const history = [...world.l1_working_memory.processed_events, ...world.l1_working_memory.new_events];
    const removed = new Set<L1HistoryItem>();
    const protectedIds = new Set([
        ...options.focus.triggerMessageIds,
        ...options.focus.quoteMessageIds,
        ...(options.focus.explicitWorkingState?.sourceMessageIds ?? []),
    ]);
    // Even scheduled triggers retain the last source message; unknown anchors never cause its eviction.
    const latest = history.filter((item) => item.type === "message").at(-1);
    if (latest) protectedIds.add(latest.id);
    const recallOwners = manualRecallOwners(history);
    // Keep the latest started turn intact through heartbeat continuations. A late event
    // from an older turn does not make that older turn the active one again.
    const seenTurns = new Set<string>();
    let latestTurn: string | undefined;
    for (const item of history) {
        if (!("turnId" in item) || recallOwners.has(item) || seenTurns.has(item.turnId)) continue;
        seenTurns.add(item.turnId);
        latestTurn = item.turnId;
    }
    const protectedEvents = new Set([...recallOwners].filter(([, owner]) => owner === undefined).map(([item]) => item));
    const protectedItem = (item: L1HistoryItem) =>
        protectedEvents.has(item) ||
        (item.type === "message" && protectedIds.has(item.id)) ||
        ("turnId" in item && (recallOwners.get(item) ?? item.turnId) === latestTurn);
    const l2 = [...(world.l2_retrieved_memories ?? [])];
    const l3 = [...(world.l3_diary_entries ?? [])];
    const removedL2 = new Set<number>();
    const removedL3 = new Set<number>();
    let projection = world;
    const recalculate = async () => {
        projection = {
            ...world,
            l1_working_memory: {
                processed_events: world.l1_working_memory.processed_events.filter((item) => !removed.has(item)),
                new_events: world.l1_working_memory.new_events.filter((item) => !removed.has(item)),
            },
            l2_retrieved_memories: l2.filter((_, index) => !removedL2.has(index)),
            l3_diary_entries: l3.filter((_, index) => !removedL3.has(index)),
        };
        report.inputTokens = await options.estimate(projection);
    };
    const over = () => report.inputTokens > options.budgetTokens;
    // Summaries/recalls yield before exact source messages. Lowest relevance yields first.
    for (let index = 0; index < l3.length && over(); index++) {
        removedL3.add(index);
        report.droppedL3++;
        await recalculate();
    }
    for (const { index } of l2.map((item, index) => ({ index, relevance: item.relevance })).sort((a, b) => a.relevance - b.relevance)) {
        if (!over()) break;
        removedL2.add(index);
        report.droppedL2++;
        await recalculate();
    }
    const groups = new Map<string | L1HistoryItem, L1HistoryItem[]>();
    for (const item of history) {
        // Consumed manual recall pages belong to the consuming turn, not their synthetic page turn.
        const owner = recallOwners.get(item);
        const key = owner ?? ("turnId" in item ? item.turnId : item);
        const group = groups.get(key) ?? [];
        group.push(item);
        groups.set(key, group);
    }
    const processed = new Set(world.l1_working_memory.processed_events);
    const candidates = [...groups.values()].sort((a, b) => Number(!a.some((item) => processed.has(item))) - Number(!b.some((item) => processed.has(item))));
    for (const group of candidates) {
        if (!over()) break;
        if (group.some(protectedItem)) continue;
        group.forEach((item) => removed.add(item));
        report.droppedEvents += group.length;
        if (group.some((item) => "turnId" in item)) report.droppedAgentTurns++;
        await recalculate();
    }
    report.protectedOverBudget = over();
    report.reason = over()
        ? "protected_sources_or_fixed_overhead_exceed_soft_budget"
        : removed.size || removedL2.size || removedL3.size
          ? "removed_lower_priority_context"
          : "within_soft_budget";
    return { worldState: projection, report };
}
