import { claimCategories, type ClaimChange } from "./claims";
import { buildProfileMessages } from "./profile-prompt";
import { visibleProfile } from "./profile-tools";
import { type Evidence, type PersonStore, type Provenance } from "./store";
import { type SummaryJob, type SummaryQueue } from "./summary-queue";

function evidenceSceneKey(item: Evidence) {
    return item.provenance?.scene || JSON.stringify([item.provenance?.platform ?? "", item.provenance?.selfId ?? "", item.provenance?.channelId ?? ""]);
}

export function summaryResponseText(result: { text?: string; finishReason?: string }, budget: number): string {
    if (result.finishReason === "length")
        throw new Error(`人物总结达到输出上限 ${budget} token，正文可能被截断，未创建候选；可提高后台总结输出上限或选用较少推理的模型`);
    if (typeof result.text !== "string" || !result.text.trim()) throw new Error("人物总结返回空白正文，未创建候选；请检查模型输出预算及推理设置");
    return result.text;
}

export interface WorkerConfig {
    threshold: number;
    cooldownMs: number;
    timeoutMs: number;
    maxQueue: number;
    systemPrompt?: string;
    sourceAllowed?: (scope: string, userId: string, evidence: Evidence) => boolean;
    durableQueue?: SummaryQueue;
    retryDelayMs?: number;
}
export type SummaryModel = (
    messages: Array<{ role: "system" | "user"; content: string }>,
    signal: AbortSignal,
    attribution?: { platform?: string; botId?: string; target?: string; purpose: string },
) => Promise<string>;
interface Job {
    key: string;
    scope: string;
    userId: string;
    promise: Promise<string>;
    resolve: (id: string) => void;
    reject: (error: Error) => void;
    durable?: SummaryJob;
    claimed?: boolean;
    authorized?: () => boolean;
    persisted?: Promise<SummaryJob>;
}
export class SummaryWorker {
    private stopped = false;
    private recovering = false;
    private persistence = new Set<Promise<SummaryJob>>();
    private retryTimers = new Set<ReturnType<typeof setTimeout>>();
    private checkpoints = new Map<string, string[]>();
    private queue: Job[] = [];
    private jobs = new Map<string, Job>();
    private usage = new Map<string, { count: number; last: number }>();
    private results = new Map<string, { time: number; account: string; result?: string; error?: string }>();
    private running?: Promise<void>;
    private current?: { job: Job; controller: AbortController };
    constructor(
        private store: PersonStore,
        private model: SummaryModel | undefined,
        private config: WorkerConfig,
        private report: (error: unknown) => void,
    ) {}
    async init() {
        if (!this.model || this.stopped || !this.config.durableQueue) return;
        this.recovering = true;
        try {
            for (const durable of await this.config.durableQueue.pending()) {
                const delay = Math.max(0, durable.nextAttempt - Date.now());
                if (delay) this.schedule(durable, delay);
                else this.summarize(durable.scope, durable.userId, durable).catch(this.report);
            }
        } finally {
            this.recovering = false;
        }
    }
    private schedule(durable: SummaryJob, delay: number) {
        if (this.stopped) return;
        const timer = setTimeout(() => {
            this.retryTimers.delete(timer);
            if (!this.stopped) this.summarize(durable.scope, durable.userId, durable).catch(this.report);
        }, delay);
        timer.unref?.();
        this.retryTimers.add(timer);
    }
    async observe(scope: string, userId: string) {
        if (!this.model || this.stopped) return;
        const key = JSON.stringify([scope, userId]);
        let usage = this.usage.get(key);
        if (!usage) {
            if (this.usage.size >= 512) this.usage.delete(this.usage.keys().next().value!);
            this.usage.set(key, (usage = { count: 0, last: 0 }));
        }
        usage.count++;
        if (usage.count < this.config.threshold || Date.now() - usage.last < this.config.cooldownMs || this.jobs.has(key)) return;
        const state = await this.store.read(scope);
        if (state.settings.paused || state.settings.mode === "off") return;
        usage.count = 0;
        usage.last = Date.now(); // Errors also have cooldown: avoid repeated failing model calls.
        this.summarize(scope, userId).catch((error) => this.report(error));
    }
    summarize(scope: string, userId: string, resumed?: SummaryJob): Promise<string> {
        if (!this.model) return Promise.reject(new Error("请先在插件配置中指定总结模型组"));
        if (this.stopped) return Promise.reject(new Error("任务已取消"));
        const key = JSON.stringify([scope, userId]);
        const existing = this.jobs.get(key);
        if (existing) return existing.promise;
        if (!this.recovering && this.queue.length >= this.config.maxQueue) return Promise.reject(new Error("总结队列已满，请稍后重试"));
        let resolve!: Job["resolve"], reject!: Job["reject"];
        const promise = new Promise<string>((r, j) => {
            resolve = r;
            reject = j;
        });
        const job: Job = { key, scope, userId, promise, resolve, reject };
        if (this.config.durableQueue) {
            const persisted = resumed ? Promise.resolve(resumed) : this.config.durableQueue.enqueue(scope, userId);
            job.persisted = persisted;
            this.persistence.add(persisted);
            persisted.then(
                () => this.persistence.delete(persisted),
                () => this.persistence.delete(persisted),
            );
        }
        this.queue.push(job);
        this.jobs.set(key, job);
        this.pump();
        return promise;
    }
    private pump() {
        if (this.running || this.stopped || !this.queue.length) return;
        this.running = this.run().finally(() => {
            this.running = undefined;
            this.pump();
        });
    }
    private async run() {
        while (!this.stopped && this.queue.length) {
            const job = this.queue.shift()!,
                controller = new AbortController();
            this.current = { job, controller };
            try {
                const durableQueue = this.config.durableQueue;
                if (durableQueue) {
                    job.durable = await job.persisted!;
                    if (!(await durableQueue.valid(job.durable))) throw new Error("任务已取消或失效");
                    if (!durableQueue.claim(job.durable)) throw new Error("总结任务已由其他工作器处理");
                    job.claimed = true;
                    const remaining = job.durable.nextAttempt - Date.now();
                    if (remaining > 0) {
                        // Timers can wake before the wall-clock deadline (or the
                        // clock can move backwards). Keep a wakeup for this job.
                        this.schedule(job.durable, remaining);
                        throw new Error("总结任务等待重试");
                    }
                    if (job.durable.attempts >= 3 && !job.durable.output) throw new Error("总结任务已达重试上限");
                    await durableQueue.patch(job.durable, { attempts: job.durable.attempts + 1 });
                }
                const result = await this.execute(job, controller);
                if (job.durable)
                    await durableQueue!.accept(job.durable, result, () => !this.stopped && !controller.signal.aborted && job.authorized?.() !== false);
                this.record(job.scope, { time: Date.now(), account: job.userId, result });
                job.resolve(result);
            } catch (error) {
                if (job.claimed && job.durable && this.config.durableQueue && !this.stopped && !String(error).includes("等待重试")) {
                    const reason = String(error).slice(0, 400);
                    const blocked = /暂停|关闭|锁定|过期|没有此账号|没有可用|取消|失效/.test(reason);
                    const attempts = Math.max(1, job.durable.attempts);
                    try {
                        await this.config.durableQueue.patch(job.durable, {
                            attempts,
                            status: blocked ? "blocked" : attempts >= 3 ? "failed" : "pending",
                            reason,
                            nextAttempt: Date.now() + (this.config.retryDelayMs ?? 1000) * 2 ** Math.max(0, attempts - 1),
                        });
                        if (job.durable.status === "pending") this.schedule(job.durable, Math.max(1, job.durable.nextAttempt - Date.now()));
                    } catch (persistError) {
                        this.report(persistError);
                    }
                }
                this.record(job.scope, { time: Date.now(), account: job.userId, error: String(error).slice(0, 400) });
                job.reject(error instanceof Error ? error : new Error(String(error)));
            } finally {
                if (job.claimed && job.durable) this.config.durableQueue!.release(job.durable);
                this.jobs.delete(job.key);
                this.current = undefined;
            }
        }
    }
    private record(scope: string, value: { time: number; account: string; result?: string; error?: string }) {
        if (!this.results.has(scope) && this.results.size >= 256) this.results.delete(this.results.keys().next().value!);
        this.results.set(scope, value);
    }
    status(scope: string) {
        return {
            modelConfigured: !!this.model,
            runningAccount: this.current?.job.scope === scope ? this.current.job.userId : undefined,
            queuedAccounts: this.queue.filter((job) => job.scope === scope).map((job) => job.userId),
            last: this.results.get(scope),
        };
    }
    private async execute(job: Job, controller: AbortController) {
        const { scope, userId } = job;
        const state = await this.store.read(scope);
        if (state.settings.paused || state.settings.mode === "off") throw new Error("维护已暂停或关闭");
        const found = await this.store.find(scope, userId);
        const a = found?.accounts.find((a) => a.userId === userId),
            p = found?.person;
        if (!a || !p) throw new Error("当前场景没有此账号");
        if (p.locked) throw new Error("画像已被管理员锁定");
        const durable = job.durable;
        const durableQueue = this.config.durableQueue;
        if (durable && !(await durableQueue!.valid(durable))) throw new Error("任务已取消或失效");
        const saved = durable?.input;
        const claimMode = saved ? saved.protocol === "claims" : !!p.claims?.length;
        const claimRevisions = saved?.claimRevisions ?? Object.fromEntries((p.claims ?? []).map((claim) => [claim.id, claim.revision]));
        if (saved && (saved.expected.personId !== p.id || saved.expected.personRevision !== p.revision || saved.expected.accountRevision !== a.revision)) {
            // A persisted output may already have committed before ack; the store
            // checks its request receipt before expected revisions below.
            if (!durable?.output) throw new Error("人物总结输入已过期");
        }
        const to = Date.now();
        const from = to - 7 * 86400000;
        const recorded = (await this.store.profileSources(scope, userId, from))
            // profileSources validates each originating account's binding, including linked accounts.
            .filter((e) => e.timestamp >= from && e.timestamp <= to && (!this.config.sourceAllowed || this.config.sourceAllowed(scope, userId, e)))
            .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
        const sourceAllowed = (item: Evidence) => !this.config.sourceAllowed || this.config.sourceAllowed(scope, userId, item);
        // Manual/legacy prose has no scene authorization basis. Leave it in the
        // store, but let authorized new evidence be summarized without it.
        const omitUnattributedProfile = !!(
            this.config.sourceAllowed &&
            !p.stale &&
            p.profile &&
            !p.structuredProfile &&
            !p.evidence.length &&
            !p.claims?.some((claim) => claim.status !== "retired")
        );
        // Persist the authorization basis of every piece of supplied context,
        // including earlier profile and claim evidence, not just new messages.
        const permissionEvidence = saved?.permissionEvidence ?? [
            ...recorded,
            ...(!p.stale ? p.evidence : []),
            ...(claimMode ? (p.claims ?? []).flatMap((claim) => claim.evidence) : []),
        ];
        const inputsAllowed = () => {
            if (!this.config.sourceAllowed) return true;
            // Older saved requests may still contain the unattributed prose;
            // only replay requests that recorded its omission explicitly.
            if (saved && omitUnattributedProfile && !saved.omittedUnattributedProfile) return false;
            if (saved && !saved.permissionEvidence) return false;
            if (!permissionEvidence.length || !permissionEvidence.every(sourceAllowed)) return false;
            const profile = p.stale ? undefined : p.structuredProfile;
            return (
                !profile ||
                profile.scenes.every((scene) => permissionEvidence.some((source) => source.provenance?.scene === scene.key && sourceAllowed(source)))
            );
        };
        job.authorized = inputsAllowed;
        if (!inputsAllowed()) throw new Error("人物总结输入来源权限已失效");
        const evidence = recorded.slice(-40);
        if (!evidence.length) throw new Error("当前账号没有可用的消息来源");
        if (saved && saved.evidenceIds.some((id) => !recorded.some((item) => item.id === id))) throw new Error("人物总结输入来源已失效");
        const sourceCursor = recorded.map((item) =>
            JSON.stringify([
                item.provenance?.platform ?? "",
                item.provenance?.selfId ?? "",
                item.provenance?.channelId ?? "",
                item.provenance?.messageId ?? item.id,
                item.userId,
            ]),
        );
        const checkpoint = durable?.checkpoint ?? this.checkpoints.get(job.key) ?? [];
        if (!saved && sourceCursor.every((id) => checkpoint.includes(id))) return "没有新增可靠信息";
        const expected = { personId: p.id, personRevision: p.revision, accountRevision: a.revision };
        const grouped = new Map<string, Evidence[]>();
        for (const item of recorded) {
            const key = evidenceSceneKey(item);
            const group = grouped.get(key) ?? [];
            group.push(item);
            grouped.set(key, group);
        }
        const scenes = [...grouped].map(([key, items]) => {
            const latest = items[items.length - 1];
            return {
                key,
                platform: latest.provenance?.platform ?? "",
                selfId: latest.provenance?.selfId ?? "",
                channelId: latest.provenance?.channelId ?? "",
                nickname: latest.name,
                recent: {
                    from,
                    to,
                    coverage: "recorded_only",
                    messageCount: items.length,
                    activeDays: new Set(items.map((item) => new Date(item.timestamp).toISOString().slice(0, 10))).size,
                },
                sampleCount: evidence.filter((item) => evidenceSceneKey(item) === key).length,
            };
        });
        let messages = buildProfileMessages(
            {
                target: { scope, userId, personId: p.id, name: p.name },
                existingProfile: omitUnattributedProfile ? "" : visibleProfile(p).profile,
                existingStructuredProfile: omitUnattributedProfile ? undefined : visibleProfile(p).structuredProfile,
                ...(claimMode
                    ? {
                          claims: p.claims?.map(({ id, revision, status, category, scene, statement, evidence }) => ({
                              id,
                              revision,
                              status,
                              category,
                              scene,
                              statement,
                              evidence,
                          })),
                      }
                    : {}),
                evidence,
                window: { from, to, coverage: "recorded_only", dayBoundary: "UTC" },
                scenes,
            },
            this.config.systemPrompt,
        );
        if (this.stopped || controller.signal.aborted) throw new Error("任务已取消");
        const sources = evidence.map((item) => item.provenance).filter((source): source is Provenance => !!source);
        const first = sources[0];
        const singleTarget =
            first &&
            sources.length === evidence.length &&
            sources.every((source) => source.platform === first.platform && source.selfId === first.selfId && source.channelId === first.channelId);
        const attribution = singleTarget
            ? { platform: first.platform, botId: first.selfId, target: first.channelId, purpose: "人物记忆摘要" }
            : { purpose: "人物记忆摘要" };
        if (saved) messages = saved.messages;
        if (durable && !saved)
            await durableQueue!.patch(durable, {
                input: {
                    protocol: claimMode ? "claims" : "profile",
                    omittedUnattributedProfile: omitUnattributedProfile,
                    permissionEvidence,
                    claimRevisions,
                    messages,
                    expected,
                    evidenceIds: evidence.map((item) => item.id),
                    sourceCursor,
                    attribution,
                },
            });
        // Persistence yields to administrator actions too. Recheck policy and
        // identity immediately before spending an inference on the saved input.
        const latestState = await this.store.read(scope);
        if (latestState.settings.paused || latestState.settings.mode === "off") throw new Error("维护已暂停或关闭");
        const latest = await this.store.find(scope, userId);
        const latestAccount = latest?.accounts.find((account) => account.userId === userId);
        if (!latestAccount || !latest?.person) throw new Error("当前场景没有此账号");
        if (latest.person.locked) throw new Error("画像已被管理员锁定");
        const inputExpected = saved?.expected ?? expected;
        if (
            !durable?.output &&
            (latest.person.id !== inputExpected.personId ||
                latest.person.revision !== inputExpected.personRevision ||
                latestAccount.revision !== inputExpected.accountRevision)
        )
            throw new Error("人物总结输入已过期");
        if (durable && !(await durableQueue!.valid(durable))) throw new Error("任务已取消或失效");
        if (this.stopped || controller.signal.aborted) throw new Error("任务已取消");
        if (!inputsAllowed()) throw new Error("人物总结输入来源权限已失效");
        const timer = setTimeout(() => controller.abort(new Error("总结模型超时")), this.config.timeoutMs);
        let abort!: () => void;
        const cancelled = new Promise<never>((_, reject) => {
            abort = () => reject(controller.signal.reason instanceof Error ? controller.signal.reason : new Error("任务已取消"));
            controller.signal.addEventListener("abort", abort, { once: true });
        });
        let output: string;
        try {
            output = durable?.output
                ? JSON.stringify(durable.output)
                : await Promise.race([this.model!(messages, controller.signal, saved?.attribution ?? attribution), cancelled]);
        } finally {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", abort);
        }
        if (this.stopped || controller.signal.aborted) throw new Error("任务已取消");
        if (!inputsAllowed()) throw new Error("人物总结输入来源权限已失效");
        if (typeof output !== "string" || !output.trim()) throw new Error("人物总结返回空白正文，未创建候选；请检查模型输出预算及推理设置");
        if (output.length > 32000) throw new Error("人物总结正文超出长度限制，未创建候选");
        let parsed: any;
        try {
            parsed = JSON.parse(output.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
        } catch {
            throw new Error("人物总结正文不是完整 JSON，未创建候选；请检查输出截断及模型格式设置");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("人物总结 JSON 结构无效，未创建候选");
        if (claimMode && (!Array.isArray(parsed.changes) || parsed.changes.length > 20 || Object.hasOwn(parsed, "profile")))
            throw new Error("人物总结主张变更格式无效");
        if ((!claimMode && parsed.profile === "") || (claimMode && Array.isArray(parsed.changes) && parsed.changes.length === 0)) {
            // A no-op still consumes source progress: it must not acknowledge an
            // obsolete view after an administrator changed the profile in flight.
            const current = await this.store.read(scope);
            const person = current.people[inputExpected.personId];
            const account = Object.values(current.accounts).find((account) => account.userId === userId);
            if (current.settings.paused || current.settings.mode === "off" || person?.locked) throw new Error("维护已暂停、关闭或锁定");
            if (
                !person ||
                !account ||
                account.personId !== person.id ||
                person.revision !== inputExpected.personRevision ||
                account.revision !== inputExpected.accountRevision
            )
                throw new Error("人物总结输入已过期");
            if (this.stopped || controller.signal.aborted || !inputsAllowed()) throw new Error("人物总结输入来源权限已失效");
            this.checkpoints.set(job.key, saved?.sourceCursor ?? sourceCursor);
            return "没有新增可靠信息";
        }
        const evidenceIds = new Set(saved?.evidenceIds ?? evidence.map((item) => item.id));
        if (claimMode) {
            if (!Array.isArray(parsed.changes) || parsed.changes.length > 20 || Object.hasOwn(parsed, "profile")) throw new Error("人物总结主张变更格式无效");
            for (const change of parsed.changes as ClaimChange[]) {
                if (!change || !["support", "counter", "revise", "retire"].includes(change.action)) throw new Error("人物总结主张操作无效");
                if (change.claimId) {
                    if (!Object.hasOwn(claimRevisions, change.claimId) || change.expectedRevision !== claimRevisions[change.claimId])
                        throw new Error("人物总结引用了未展示的主张或过期版本");
                } else if (
                    change.action !== "support" ||
                    !claimCategories.includes(change.category!) ||
                    typeof change.statement !== "string" ||
                    !change.statement.trim()
                )
                    throw new Error("人物总结新主张需要支持、分类和陈述");
                if (
                    !Array.isArray(change.messageIds) ||
                    change.messageIds.length > 10 ||
                    (change.action !== "retire" && !change.messageIds.length) ||
                    new Set(change.messageIds).size !== change.messageIds.length ||
                    change.messageIds.some((id) => typeof id !== "string" || !evidenceIds.has(id))
                )
                    throw new Error("人物总结主张必须引用输入中的不同证据 ID");
            }
        } else if (
            !Array.isArray(parsed.messageIds) ||
            parsed.messageIds.length < 1 ||
            parsed.messageIds.length > 10 ||
            new Set(parsed.messageIds).size !== parsed.messageIds.length ||
            parsed.messageIds.some((id: unknown) => typeof id !== "string" || !evidenceIds.has(id))
        )
            throw new Error("人物总结必须引用 1 到 10 个输入中的不同证据 ID，未创建候选");
        if (durable && !durable.output) await durableQueue!.patch(durable, { output: parsed });
        if (durable && !(await durableQueue!.valid(durable))) throw new Error("任务已取消或失效");
        const active = () => !this.stopped && !controller.signal.aborted && inputsAllowed();
        if (!active()) throw new Error("人物总结输入来源权限已失效");
        const proposal = claimMode
            ? await this.store.proposeClaims(scope, userId, parsed.changes, "summary-model", saved?.expected ?? expected, active, durable?.id)
            : await this.store.propose(scope, userId, parsed.profile, parsed.messageIds, "summary-model", saved?.expected ?? expected, active, durable?.id);
        this.checkpoints.set(job.key, saved?.sourceCursor ?? sourceCursor);
        return proposal.id;
    }
    cancel(scope: string) {
        const pending = [...this.persistence];
        const invalidated = this.config.durableQueue ? Promise.allSettled(pending).then(() => this.config.durableQueue!.cancel(scope)) : undefined;
        const cancelled = this.queue.filter((job) => job.scope === scope);
        this.queue = this.queue.filter((job) => job.scope !== scope);
        for (const job of cancelled) {
            this.jobs.delete(job.key);
            job.reject(new Error("任务已取消"));
        }
        if (this.current?.job.scope === scope) this.current.controller.abort(new Error("任务已取消"));
        return invalidated ?? Promise.resolve();
    }
    stop() {
        this.stopped = true;
        for (const timer of this.retryTimers) clearTimeout(timer);
        this.retryTimers.clear();
        this.current?.controller.abort(new Error("任务已取消"));
        for (const job of this.queue) {
            this.jobs.delete(job.key);
            job.reject(new Error("任务已取消"));
        }
        this.queue = [];
        this.usage.clear();
        this.results.clear();
        return Promise.allSettled(this.persistence).then(() => this.idle());
    }
    async idle() {
        while (this.running) await this.running;
    }
}
