import type { MemoryTarget, SemanticMemoryScope } from "./l2-semantic-memory";
import type { HistoryChannelType, MessageData } from "./types";

interface HistoryCoordination {
    channelTypes: Map<string, HistoryChannelType>;
    generations: Map<string, number>;
    activeClears: Set<{ scope: SemanticMemoryScope; done: Promise<void> }>;
    pendingWrites: Set<{ target: MemoryTarget; done: Promise<unknown> }>;
    buffers: Set<WeakRef<Map<string, MessageData[]>>>;
    invalidations: Set<{ target: MemoryTarget; invalidate: () => void }>;
    retentionCutoff: number;
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
        state = {
            channelTypes: new Map(),
            generations: new Map(),
            activeClears: new Set(),
            pendingWrites: new Set(),
            buffers: new Set(),
            invalidations: new Set(),
            retentionCutoff: -Infinity,
        };
        coordinators.set(database, state);
    }
    return state;
}

/** Exclusive operations share the same physical database as accepted history writes. */
export async function withHistoryBarrier<T>(state: HistoryCoordination, scope: SemanticMemoryScope, operation: () => Promise<T>): Promise<T> {
    const matches = (target: MemoryTarget, selected: SemanticMemoryScope) => {
        if (!("type" in selected)) return target.platform === selected.platform && target.channelId === selected.channelId;
        const type = target.channelType || state.channelTypes.get(JSON.stringify([target.platform, target.channelId]));
        return selected.type === "all" || type === selected.type;
    };
    const previous = [...state.activeClears].filter(({ scope: other }) => {
        if (!("type" in scope)) return matches(scope, other);
        if (!("type" in other)) return matches(other, scope);
        return scope.type === "all" || other.type === "all" || scope.type === other.type;
    });
    let release!: () => void;
    const barrier = {
        scope,
        done: new Promise<void>((resolve) => {
            release = resolve;
        }),
    };
    state.activeClears.add(barrier);
    try {
        await Promise.all(previous.map((entry) => entry.done));
        await Promise.allSettled([...state.pendingWrites].filter((entry) => matches(entry.target, scope)).map((entry) => entry.done));
        return await operation();
    } finally {
        state.activeClears.delete(barrier);
        release();
    }
}
