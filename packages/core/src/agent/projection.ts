import type { L1HistoryItem, WorldState } from "../world/types";

/** Model input is a disposable conversation projection; the audit journal stays intact. */
function withoutPrivateReasoning(value: any): any {
    if (Array.isArray(value)) return value.map(withoutPrivateReasoning);
    if (!value || typeof value !== "object" || value instanceof Date) return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !["inner_thoughts", "reasoning_content"].includes(key))
            .map(([key, item]) => [key, withoutPrivateReasoning(item)]),
    );
}
export function toolEventDetails(item: any): any {
    try {
        return JSON.parse(
            item.eventDetails
                .replace(/&quot;/g, '"')
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&amp;/g, "&"),
        )?.details;
    } catch {
        return undefined;
    }
}
export function projectWorldForModel(world: WorldState): { world: WorldState; duplicateReceiptIds: string[] } {
    const all = [...world.l1_working_memory.processed_events, ...world.l1_working_memory.new_events];
    const observations = all.filter((item) => item.type === "agent_observation");
    const duplicateReceiptIds: string[] = [];
    const project = (items: L1HistoryItem[]): L1HistoryItem[] =>
        items.flatMap((item) => {
            if (item.type === "agent_thought" || item.type === "agent_heartbeat") return [];
            if (item.type === "system_event" && item.eventType === "tool-result") {
                const details = toolEventDetails(item);
                if (
                    details?.actor === "model" &&
                    observations.some(
                        (observation) =>
                            typeof details.actionId === "string" &&
                            observation.actionId === details.actionId &&
                            observation.function === details.operation &&
                            observation.status === details.status,
                    )
                ) {
                    duplicateReceiptIds.push(item.id);
                    return [];
                }
                // Admin/external receipts have no model observation: keep the causal outcome once,
                // never replay the diagnostic receipt, transport ownership or raw tool arguments.
                return [
                    {
                        ...item,
                        message: typeof details?.summary === "string" ? details.summary : "工具调用已返回。",
                        eventDetails: JSON.stringify({ operation: details?.operation, status: details?.status }),
                    },
                ];
            }
            if (item.type === "agent_action" && item.function === "send_message" && typeof item.params.message === "string") {
                const outcome = observations.find(
                    (observation) =>
                        item.actionId &&
                        observation.actionId === item.actionId &&
                        observation.function === "send_message" &&
                        observation.status === "success" &&
                        observation.timestamp >= item.timestamp,
                );
                if (outcome) {
                    const parts = item.params.message
                        .split(/<sep\s*\/>/)
                        .map((part) => part.trim())
                        .filter(Boolean);
                    const visible = all.filter(
                        (source) =>
                            source.type === "message" &&
                            source.sender.id === world.self?.id &&
                            source.timestamp >= item.timestamp &&
                            source.timestamp <= outcome.timestamp,
                    );
                    const matches = parts.map((part) => visible.find((source) => source.type === "message" && source.content.trim() === part));
                    if (parts.length && matches.every((source) => source?.type === "message")) {
                        return [{ ...item, params: { messageIds: matches.map((source) => (source!.type === "message" ? source.id : "")) } }];
                    }
                }
            }
            return [withoutPrivateReasoning(item)];
        });
    return {
        world: {
            ...world,
            l1_working_memory: { processed_events: project(world.l1_working_memory.processed_events), new_events: project(world.l1_working_memory.new_events) },
        },
        duplicateReceiptIds,
    };
}
