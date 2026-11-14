import type { Context } from "koishi";
import * as core from "koishi-plugin-yesimbot";

import type { PersonStore } from "./store";
import type { SummaryWorker } from "./worker";

type ResetScope = { type: "all" | "private" | "guild" } | { platform: string; channelId: string };
type Preparation = { ready: Promise<void>; release: () => void; report: () => string | undefined };
const runtime = core as typeof core & {
    registerHistoryResetParticipant?: (ctx: Context, participant: { prepare(scope: ResetScope): Preparation | void }) => () => void;
};

/** Fence the owning extension synchronously before draining asynchronous work. */
export class PersonHistoryReset {
    private depth = 0;
    private generation = 0;
    private pending = new Set<Promise<unknown>>();
    constructor(private ctx: Context) {}
    available = () => this.depth === 0;
    epoch = () => this.generation;
    domain = () => JSON.stringify([runtime.getInstanceScope(this.ctx), runtime.getInstanceScope(this.ctx, undefined, { owner: this.ctx })]);
    track<T>(promise: Promise<T>): Promise<T> {
        this.pending.add(promise);
        void promise.finally(() => this.pending.delete(promise)).catch(() => {});
        return promise;
    }
    install(store: PersonStore, worker: SummaryWorker, _scopeOf: (session: any) => string, _shared: boolean, clearLocal: () => void) {
        return runtime.registerHistoryResetParticipant?.(this.ctx, {
            prepare: (scope) => {
                if (!("type" in scope) || scope.type !== "all") return;
                this.depth++;
                this.generation++;
                clearLocal();
                const resetting = worker.reset();
                let report: string | undefined;
                const ready = (async () => {
                    await Promise.allSettled(this.pending);
                    const queueScopes = await resetting;
                    // Routing and bot IDs do not prove ownership of old opaque rows.
                    // Only persistent ownership or this worker's domain queue may purge.
                    await store.purgeOwned(queueScopes);
                    const summary = store.purgeReport();
                    report = `人物资料：清理 ${summary.cleared} 个已证明自有范围；保留 ${summary.retained} 个存在其他所有者的范围。其他实例与无法证明归属的旧资料未删除；总结任务及缓存已取消。`;
                })();
                return {
                    ready,
                    report: () => report,
                    release: () => {
                        this.depth--;
                        if (!this.depth) worker.resume();
                    },
                };
            },
        });
    }
}
export const readPersonAction = (params: Record<string, unknown>) =>
    ["read", "read_many", "list", "search", "history", "claims", "claim_evidence"].includes(String(params.action));
