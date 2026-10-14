import type { Session } from "koishi";

export const REPLY_CATEGORIES = ["text", "at", "quote", "direct", "system", "scheduled", "background"] as const;
export type ReplyCategory = (typeof REPLY_CATEGORIES)[number];
export interface ReplyTarget {
    platform: string;
    selfId: string;
    channelId: string;
    isDirect?: boolean;
}
export interface ReplyActor {
    id: string;
    origin: { platform: string; selfId: string; channelId: string; adapter?: string };
}
export interface ReplyRule extends ReplyTarget {
    id: string;
    blocked: string[];
    expiresAt: number | null;
}
export function replyKey(target: ReplyTarget): string {
    return JSON.stringify([target.platform, target.selfId, target.channelId]);
}
export function messageCategories(session: Session): ReplyCategory[] {
    const categories: ReplyCategory[] = ["text"];
    if (session.stripped?.atSelf || session.elements?.some((e) => e.type === "at")) categories.push("at");
    if (session.quote || session.elements?.some((e) => e.type === "quote")) categories.push("quote");
    if (session.isDirect) categories.push("direct");
    return categories;
}

/** Durable rules; generation changes invalidate old work even after an immediate resume. */
export class ReplyControl {
    private rules = new Map<string, ReplyRule>();
    private generations = new Map<string, number>();
    private pending: Promise<void> = Promise.resolve();
    constructor(
        private storage: { load(): Promise<ReplyRule[]>; save(rule: ReplyRule): Promise<void>; remove(id: string): Promise<void> },
        private changed: (target: ReplyTarget, reason: string) => void,
        private record: (target: ReplyTarget, reason: string, rule?: ReplyRule, actor?: ReplyActor) => Promise<void>,
        private now = Date.now,
        private backgroundError: (error: unknown) => void = () => {},
    ) {}
    public async initialize(): Promise<void> {
        for (const rule of await this.storage.load()) this.rules.set(rule.id, rule);
        this.expire();
        await this.flush();
    }
    private invalidate(target: ReplyTarget, reason: string): void {
        const id = replyKey(target);
        this.generations.set(id, this.token(target) + 1);
        this.changed(target, reason);
    }
    private enqueue(task: () => Promise<void>): Promise<void> {
        const pending = this.pending.then(task);
        this.pending = pending.catch(() => {});
        return pending;
    }
    public flush(): Promise<void> {
        return this.pending;
    }
    public token(target: ReplyTarget): number {
        return this.generations.get(replyKey(target)) || 0;
    }
    public valid(target: ReplyTarget, token: number): boolean {
        this.get(target);
        return this.token(target) === token;
    }
    /** 只读状态；查询不能触发到期清理、任务取消或持久写入。 */
    public peek(target: ReplyTarget): ReplyRule | undefined {
        const rule = this.rules.get(replyKey(target));
        if (!rule || (rule.expiresAt !== null && rule.expiresAt <= this.now())) return undefined;
        return structuredClone(rule);
    }
    public get(target: ReplyTarget): ReplyRule | undefined {
        const id = replyKey(target);
        const rule = this.rules.get(id);
        if (rule && rule.expiresAt !== null && rule.expiresAt <= this.now()) {
            this.rules.delete(id);
            this.invalidate(target, "expired");
            void this.enqueue(async () => {
                await this.storage.remove(id);
                await this.record(target, "expired", rule);
            }).catch(this.backgroundError);
            return undefined;
        }
        return rule;
    }
    public expire(): void {
        for (const rule of [...this.rules.values()]) this.get(rule);
    }
    public find(channelId: string, platform?: string): ReplyRule[] {
        this.expire();
        return [...this.rules.values()].filter((rule) => rule.channelId === channelId && (!platform || rule.platform === platform));
    }

    public allowed(target: ReplyTarget, categories: ReplyCategory[]): ReplyCategory[] {
        const rule = this.get(target);
        if (!rule) return categories;
        return categories.filter((c) => !rule.blocked.includes("all") && !rule.blocked.includes(c));
    }
    public async set(target: ReplyTarget, blocked: string[], duration: number | null, actor?: ReplyActor): Promise<void> {
        if (blocked.some((c) => c !== "all" && !REPLY_CATEGORIES.includes(c as ReplyCategory))) throw new Error("无效的抑制类别");
        if (duration !== null && (!Number.isFinite(duration) || duration <= 0 || !Number.isSafeInteger(this.now() + duration)))
            throw new Error("无效的暂停时长");
        const reason = this.get(target) ? "replace" : "pause";
        const rule: ReplyRule = {
            ...target,
            id: replyKey(target),
            blocked: [...new Set(blocked)],
            expiresAt: duration === null ? null : this.now() + duration,
        };
        this.rules.set(rule.id, rule);
        this.invalidate(target, reason);
        await this.enqueue(async () => {
            await this.storage.save(rule);
            await this.record(target, reason, rule, actor);
        });
    }
    public async resume(target: ReplyTarget, actor?: ReplyActor): Promise<boolean> {
        const rule = this.get(target);
        this.rules.delete(replyKey(target));
        this.invalidate(target, "resume");
        await this.enqueue(async () => {
            await this.storage.remove(replyKey(target));
            await this.record(target, "resume", rule, actor);
        });
        return !!rule;
    }
}
