import type { Context } from "koishi";

import type { SemanticMemoryScope } from "./l2-semantic-memory";

export type HistoryResetScope = SemanticMemoryScope;
export type HistoryResetPreparation = void | { ready?: Promise<void>; release?: () => void | Promise<void>; report?: () => string | undefined };
export interface HistoryResetParticipant {
    /** Fence old work synchronously, then drain/purge. Return a release callback for new work. */
    prepare(scope: HistoryResetScope): HistoryResetPreparation;
}
type Registration = { ctx: Context; participant: HistoryResetParticipant };
// Core and extensions may load different CJS/ESM bundles in one Koishi process.
// A versioned global key keeps their lifecycle registrations in the same registry.
const registryKey = Symbol.for("yesimbot.historyReset.v1");
const registry = globalThis as typeof globalThis & { [registryKey]?: Set<Registration> };
const participants = (registry[registryKey] ??= new Set<Registration>());

function owner(ctx: Context): Context {
    // get() avoids undeclared self-service access inside the core. A service's
    // original descriptor retains its owner despite Cordis caller rebinding.
    const core = ctx.get?.("yesimbot");
    return (core && Object.getOwnPropertyDescriptor(core, "ctx")?.value) ?? ctx;
}

/** Join only the owning core's reset; another core sharing the database is not adopted. */
export function registerHistoryResetParticipant(ctx: Context, participant: HistoryResetParticipant): () => void {
    const entry = { ctx, participant };
    participants.add(entry);
    const unregister = () => {
        participants.delete(entry);
    };
    ctx.on?.("dispose", unregister);
    return unregister;
}

/** Must be followed immediately, without await, by clearHistory's generation/barrier entry. */
export function prepareHistoryReset(ctx: Context, scope: HistoryResetScope): { ready: Promise<void>; finish: () => Promise<void>; reports: () => string[] } {
    const releases: Array<() => void | Promise<void>> = [];
    const pending: Array<Promise<void>> = [];
    const reporters: Array<() => string | undefined> = [];
    for (const entry of participants) {
        if (owner(entry.ctx) !== owner(ctx)) continue;
        try {
            // Invoke all fences before yielding, including when one participant fails.
            const preparation = entry.participant.prepare(scope);
            if (preparation?.release) releases.push(preparation.release);
            if (preparation?.ready) pending.push(preparation.ready);
            if (preparation?.report) reporters.push(preparation.report);
        } catch (error) {
            pending.push(Promise.reject(error));
        }
    }
    const ready = Promise.allSettled(pending).then((results) => {
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
    });
    // clearHistory may wait behind an earlier maintenance operation before awaiting ready.
    void ready.catch(() => {});
    let finishing: Promise<void> | undefined;
    return {
        ready,
        reports: () =>
            reporters.flatMap((report) => {
                try {
                    const text = report();
                    return text ? [text] : [];
                } catch {
                    return ["部分相关记忆的清理回执暂不可用，请查看日志。"];
                }
            }),
        finish: () =>
            (finishing ??= (async () => {
                await ready.catch(() => {});
                const results = await Promise.allSettled(releases.map((release) => Promise.resolve().then(release)));
                const failure = results.find((result) => result.status === "rejected");
                if (failure?.status === "rejected") throw failure.reason;
            })()),
    };
}
