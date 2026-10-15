import type { L1HistoryItem } from "./types";

/** Only a turn whose request included the page can acknowledge consuming it. */
export function manualRecallOwners(history: L1HistoryItem[]): Map<L1HistoryItem, string | undefined> {
    const owners = new Map<L1HistoryItem, string | undefined>();
    const consumed = new Map<string, string>();
    for (const item of history) {
        if (item.type !== "agent_thought" && item.type !== "agent_action") continue;
        if (!Array.isArray(item.consumedRecallIds)) continue;
        for (const id of item.consumedRecallIds) if (typeof id === "string" && id && !consumed.has(id)) consumed.set(id, item.turnId);
    }
    for (const item of history) if (item.type === "agent_observation" && item.manualRecall === true) owners.set(item, consumed.get(item.turnId));
    return owners;
}

/** Pending admin input must survive ordinary history limits, including a process restart. */
export function retainPendingRecalls(history: L1HistoryItem[], limit: number): L1HistoryItem[] {
    const pending = new Set([...manualRecallOwners(history)].filter(([, owner]) => owner === undefined).map(([item]) => item));
    const recent = new Set(history.filter((item) => !pending.has(item)).slice(-limit));
    return history.filter((item) => pending.has(item) || recent.has(item));
}
