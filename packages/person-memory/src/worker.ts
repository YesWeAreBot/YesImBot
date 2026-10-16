import { buildProfileMessages } from "./profile-prompt";
import { type Evidence, type PersonStore, type Provenance } from "./store";

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
}
export class SummaryWorker {
    private stopped = false;
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
    summarize(scope: string, userId: string): Promise<string> {
        if (!this.model) return Promise.reject(new Error("请先在插件配置中指定总结模型组"));
        if (this.stopped) return Promise.reject(new Error("任务已取消"));
        const key = JSON.stringify([scope, userId]);
        const existing = this.jobs.get(key);
        if (existing) return existing.promise;
        if (this.queue.length >= this.config.maxQueue) return Promise.reject(new Error("总结队列已满，请稍后重试"));
        let resolve!: Job["resolve"], reject!: Job["reject"];
        const promise = new Promise<string>((r, j) => {
            resolve = r;
            reject = j;
        });
        const job = { key, scope, userId, promise, resolve, reject };
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
                const result = await this.execute(job, controller);
                this.record(job.scope, { time: Date.now(), account: job.userId, result });
                job.resolve(result);
            } catch (error) {
                this.record(job.scope, { time: Date.now(), account: job.userId, error: String(error).slice(0, 400) });
                job.reject(error instanceof Error ? error : new Error(String(error)));
            } finally {
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
        const to = Date.now();
        const from = to - 7 * 86400000;
        const recorded = (await this.store.profileSources(scope, userId, from))
            // profileSources validates each originating account's binding, including linked accounts.
            .filter((e) => e.timestamp >= from && e.timestamp <= to)
            .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
        const evidence = recorded.slice(-40);
        if (!evidence.length) throw new Error("当前账号没有可用的消息来源");
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
        const messages = buildProfileMessages(
            {
                target: { scope, userId, personId: p.id, name: p.name },
                existingProfile: p.stale ? "" : p.profile,
                existingStructuredProfile: p.stale ? undefined : p.structuredProfile,
                evidence,
                window: { from, to, coverage: "recorded_only", dayBoundary: "UTC" },
                scenes,
            },
            this.config.systemPrompt,
        );
        if (this.stopped || controller.signal.aborted) throw new Error("任务已取消");
        const timer = setTimeout(() => controller.abort(new Error("总结模型超时")), this.config.timeoutMs);
        let abort!: () => void;
        const cancelled = new Promise<never>((_, reject) => {
            abort = () => reject(controller.signal.reason instanceof Error ? controller.signal.reason : new Error("任务已取消"));
            controller.signal.addEventListener("abort", abort, { once: true });
        });
        const sources = evidence.map((item) => item.provenance).filter((source): source is Provenance => !!source);
        const first = sources[0];
        const singleTarget =
            first &&
            sources.length === evidence.length &&
            sources.every((source) => source.platform === first.platform && source.selfId === first.selfId && source.channelId === first.channelId);
        const attribution = singleTarget
            ? { platform: first.platform, botId: first.selfId, target: first.channelId, purpose: "人物记忆摘要" }
            : { purpose: "人物记忆摘要" };
        let output: string;
        try {
            output = await Promise.race([this.model!(messages, controller.signal, attribution), cancelled]);
        } finally {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", abort);
        }
        if (this.stopped || controller.signal.aborted) throw new Error("任务已取消");
        if (typeof output !== "string" || !output.trim()) throw new Error("人物总结返回空白正文，未创建候选；请检查模型输出预算及推理设置");
        if (output.length > 32000) throw new Error("人物总结正文超出长度限制，未创建候选");
        let parsed: any;
        try {
            parsed = JSON.parse(output.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
        } catch {
            throw new Error("人物总结正文不是完整 JSON，未创建候选；请检查输出截断及模型格式设置");
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("人物总结 JSON 结构无效，未创建候选");
        if (parsed.profile === "") return "没有新增可靠信息";
        const evidenceIds = new Set(evidence.map((item) => item.id));
        if (
            !Array.isArray(parsed.messageIds) ||
            parsed.messageIds.length < 1 ||
            parsed.messageIds.length > 10 ||
            new Set(parsed.messageIds).size !== parsed.messageIds.length ||
            parsed.messageIds.some((id: unknown) => typeof id !== "string" || !evidenceIds.has(id))
        )
            throw new Error("人物总结必须引用 1 到 10 个输入中的不同证据 ID，未创建候选");
        const proposal = await this.store.propose(
            scope,
            userId,
            parsed.profile,
            parsed.messageIds,
            "summary-model",
            expected,
            () => !this.stopped && !controller.signal.aborted,
        );
        return proposal.id;
    }
    cancel(scope: string) {
        const cancelled = this.queue.filter((job) => job.scope === scope);
        this.queue = this.queue.filter((job) => job.scope !== scope);
        for (const job of cancelled) {
            this.jobs.delete(job.key);
            job.reject(new Error("任务已取消"));
        }
        if (this.current?.job.scope === scope) this.current.controller.abort(new Error("任务已取消"));
    }
    stop() {
        this.stopped = true;
        this.current?.controller.abort(new Error("任务已取消"));
        for (const job of this.queue) {
            this.jobs.delete(job.key);
            job.reject(new Error("任务已取消"));
        }
        this.queue = [];
        this.usage.clear();
        this.results.clear();
    }
    async idle() {
        while (this.running) await this.running;
    }
}
