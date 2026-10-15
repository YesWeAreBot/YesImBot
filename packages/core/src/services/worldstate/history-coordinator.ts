import type { MemoryTarget, SemanticMemoryScope } from "./l2-semantic-memory";
import type { HistoryChannelType, MessageData } from "./types";

interface HistoryCoordination {
    channelTypes: Map<string, HistoryChannelType>;
    generations: Map<string, number>;
    activeClears: Set<{ scope: SemanticMemoryScope; done: Promise<void> }>;
    pendingWrites: Set<{ target: MemoryTarget; done: Promise<unknown> }>;
    buffers: Set<WeakRef<Map<string, MessageData[]>>>;
}

const coordinators = new WeakMap<object, HistoryCoordination>();

/** Coordinate the same physical service across Cordis' caller-specific proxies. */
export function historyCoordinator(database: object): HistoryCoordination {
    const original = Symbol.for("cordis.original");
    const seen = new Set<object>();
    while (database && typeof database === "object" && !seen.has(database)) {
        seen.add(database);
        const source = (database as any)[original];
        if (!source || source === database || typeof source !== "object") break;
        database = source;
    }
    let state = coordinators.get(database);
    if (!state) {
        state = { channelTypes: new Map(), generations: new Map(), activeClears: new Set(), pendingWrites: new Set(), buffers: new Set() };
        coordinators.set(database, state);
    }
    return state;
}
