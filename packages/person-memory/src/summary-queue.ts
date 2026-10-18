import { randomUUID } from "node:crypto";

import type { Context } from "koishi";

import type { ClaimChange } from "./claims";
import type { Evidence } from "./store";

export type SummaryOutput = { profile: any; messageIds: string[] } | { changes: ClaimChange[] };

export interface SummaryInput {
    protocol?: "profile" | "claims";
    permissionEvidence?: Evidence[];
    claimRevisions?: Record<string, number>;
    messages: Array<{ role: "system" | "user"; content: string }>;
    expected: { personId: string; personRevision: number; accountRevision: number };
    evidenceIds: string[];
    sourceCursor: string[];
    attribution?: { platform?: string; botId?: string; target?: string; purpose: string };
}
export interface SummaryJob {
    key: string;
    domain: string;
    scope: string;
    userId: string;
    id: string;
    generation: number;
    status: "pending" | "blocked" | "failed" | "accepted" | "cancelled";
    attempts: number;
    nextAttempt: number;
    reason?: string;
    input?: SummaryInput;
    output?: SummaryOutput;
    receipt?: string;
    checkpoint: string[];
}
interface QueueRow {
    key: string;
    domain: string;
    scope: string;
    job: SummaryJob;
}
const TABLE = "person_memory.summary_queue";
declare module "koishi" {
    interface Tables {
        "person_memory.summary_queue": QueueRow;
    }
}
export function registerSummaryQueueModels(ctx: Context) {
    ctx.model.extend(TABLE, { key: "string", domain: "string", scope: "string", job: "json" }, { primary: "key" });
}
// Koishi database service is shared by plugin scopes in the same process. These
// guards prevent duplicate inference by independently constructed adapters.
const guards = new WeakMap<object, { tails: Map<string, Promise<unknown>>; claims: Set<string> }>();
export class SummaryQueue {
    private guard: { tails: Map<string, Promise<unknown>>; claims: Set<string> };
    constructor(
        private db: Context["database"],
        private domain: string,
    ) {
        const identity = db.tables;
        let guard = guards.get(identity);
        if (!guard) guards.set(identity, (guard = { tails: new Map(), claims: new Set() }));
        this.guard = guard;
    }
    private key(scope: string, userId: string) {
        return JSON.stringify([this.domain, scope, userId]);
    }
    private async serial<T>(key: string, action: () => Promise<T>): Promise<T> {
        const previous = this.guard.tails.get(key) ?? Promise.resolve();
        const next = previous.catch(() => {}).then(action);
        this.guard.tails.set(key, next);
        try {
            return await next;
        } finally {
            if (this.guard.tails.get(key) === next) this.guard.tails.delete(key);
        }
    }
    private async read(key: string) {
        return (await this.db.get(TABLE, { key }))[0]?.job;
    }
    async list() {
        return (await this.db.get(TABLE, { domain: this.domain })).map((row) => row.job);
    }
    async pending() {
        return (await this.list()).filter((job) => job.status === "pending");
    }
    async checkpoint(scope: string, userId: string) {
        return (await this.read(this.key(scope, userId)))?.checkpoint ?? [];
    }
    async enqueue(scope: string, userId: string) {
        const key = this.key(scope, userId);
        return this.serial(key, async () => {
            const old = await this.read(key);
            if (old?.status === "pending") return old;
            // An unacknowledged output may already have committed in the store.
            // Explicit retries retain its request ID until admin cancellation.
            if (old?.output && old.status !== "accepted" && old.status !== "cancelled") {
                const job: SummaryJob = { ...old, status: "pending", nextAttempt: 0 };
                await this.db.set(TABLE, { key }, { job });
                return job;
            }
            const job: SummaryJob = {
                key,
                domain: this.domain,
                scope,
                userId,
                id: randomUUID(),
                generation: (old?.generation ?? 0) + 1,
                status: "pending",
                attempts: 0,
                nextAttempt: 0,
                checkpoint: old?.checkpoint ?? [],
            };
            if (old) await this.db.set(TABLE, { key }, { job });
            else await this.db.create(TABLE, { key, domain: this.domain, scope, job });
            return job;
        });
    }
    claim(job: SummaryJob) {
        if (this.guard.claims.has(job.key)) return false;
        this.guard.claims.add(job.key);
        return true;
    }
    release(job: SummaryJob) {
        this.guard.claims.delete(job.key);
    }
    async valid(job: SummaryJob) {
        const current = await this.read(job.key);
        return current?.id === job.id && current.status === "pending";
    }
    async patch(job: SummaryJob, values: Partial<SummaryJob>, active: () => boolean = () => true) {
        return this.serial(job.key, async () => {
            if (!(await this.valid(job))) throw new Error("任务已取消或失效");
            if (!active()) throw new Error("人物总结输入来源权限已失效");
            const updated = { ...job, ...values };
            await this.db.set(TABLE, { key: job.key }, { job: updated });
            Object.assign(job, updated);
        });
    }
    async accept(job: SummaryJob, receipt: string, active: () => boolean = () => true) {
        await this.patch(
            job,
            { status: "accepted", receipt, checkpoint: job.input?.sourceCursor ?? job.checkpoint, input: undefined, output: undefined, reason: undefined },
            active,
        );
    }
    async cancel(scope: string) {
        for (const job of (await this.list()).filter((job) => job.scope === scope)) {
            await this.serial(job.key, async () => {
                const current = await this.read(job.key);
                if (current)
                    await this.db.set(
                        TABLE,
                        { key: job.key },
                        { job: { ...current, generation: current.generation + 1, status: "cancelled", reason: "任务已取消" } },
                    );
            });
        }
    }
}
