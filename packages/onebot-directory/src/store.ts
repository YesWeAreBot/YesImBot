import { randomUUID } from "node:crypto";
import { $, type Context } from "koishi";

export const SNAPSHOTS = "yesimbot.onebot_directory_snapshots" as const;
// Reclaim abandoned and superseded revisions after one hour. Published caches do not expire.
export const REVISION_TTL_MS = 60 * 60 * 1000;
export const CONTACTS = "yesimbot.onebot_directory_contacts" as const;

export interface Snapshot {
    platform: string;
    ownerId: string;
    scope: string;
    revision: string;
    fetchedAt: Date;
    previousRevision: string;
    sourceBotId: string;
    total: number;
}

export interface Contact {
    platform: string;
    ownerId: string;
    scope: string;
    revision: string;
    userId: string;
    ordinal: number;
    revisionCreatedAt: Date;
    nickname: string;
    remark: string;
    card: string;
    role: string;
}

declare module "koishi" {
    interface Tables {
        [SNAPSHOTS]: Snapshot;
        [CONTACTS]: Contact;
    }
}

export function registerModels(ctx: Context) {
    ctx.model.extend(SNAPSHOTS, {
        platform: "string(64)", ownerId: "string(64)", scope: "string(255)", revision: "string(36)", fetchedAt: "timestamp", previousRevision: "string(36)", sourceBotId: "string(64)", total: "unsigned",
    }, { autoInc: false, primary: ["platform", "ownerId", "scope"] });
    ctx.model.extend(CONTACTS, {
        platform: "string(64)", ownerId: "string(64)", scope: "string(255)", revision: "string(36)", userId: "string(64)",
        revisionCreatedAt: { type: "timestamp", initial: new Date(0) }, ordinal: "unsigned", nickname: "string(255)", remark: "string(255)", card: "string(255)", role: "string(32)",
    }, { autoInc: false, primary: ["platform", "ownerId", "scope", "revision", "userId"] });
}

export interface OneBotContact {
    user_id: number | string;
    nickname?: string;
    remark?: string;
    card?: string;
    role?: string;
}
export interface OneBotClient {
    selfId: string;
    platform: string;
    internal: {
        getFriendList(): Promise<OneBotContact[]>;
        getGroupMemberList(groupId: string, noCache?: boolean): Promise<OneBotContact[]>;
    };
}

export interface Query {
    kind: "friends" | "members";
    groupId?: string;
    offset?: number;
    limit?: number;
    all?: boolean;
    refresh?: boolean;
    userId?: string;
    summaryOnly?: boolean;
}

/** One instance per plugin; complete snapshots remain cached until explicit refresh. */
export class DirectoryStore {
    private readonly pending = new Map<string, Promise<void>>();
    private running = 0;
    private closed = false;
    private readonly waiting: Array<{ resolve(): void; reject(error: Error): void }> = [];

    constructor(private readonly ctx: Context, private readonly concurrency: number, private readonly batchSize: number) {}

    stop() {
        this.closed = true;
        while (this.waiting.length) this.waiting.shift()?.reject(new Error("联系人插件已关闭"));
    }

    private ensureActive() {
        if (this.closed) throw new Error("联系人插件已关闭");
    }

    private async withSlot(job: () => Promise<void>) {
        if (this.running < this.concurrency) this.running++;
        else await new Promise<void>((resolve, reject) => this.waiting.push({ resolve, reject }));
        try { this.ensureActive(); await job(); }
        finally {
            const next = this.waiting.shift();
            if (next) next.resolve(); // Transfer the reserved slot directly to the next job.
            else this.running--;
        }
    }

    private async snapshot(platform: string, ownerId: string, scope: string) {
        const rows = await this.ctx.database.get(SNAPSHOTS, { platform, ownerId, scope });
        return rows[0];
    }

    async query(bot: OneBotClient, args: Query) {
        this.ensureActive();
        if (bot.platform !== "onebot" || !bot.internal) throw new Error("仅支持 OneBot 适配器");
        const platform = bot.platform;
        const ownerId = args.kind === "friends" ? String(bot.selfId) : "*";
        const scope = args.kind === "friends" ? "friends" : `group:${args.groupId || ""}`;
        if (args.kind === "members" && !args.groupId) throw new Error("查询群成员需要群号或当前群聊");
        if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0)) throw new Error("offset 必须是非负整数");
        if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 500)) throw new Error("limit 必须在 1 到 500 之间；全量请设置 all=true");
        const key = `${platform}\0${ownerId}\0${scope}`;
        await this.cleanup(platform, ownerId, scope);
        let current = await this.snapshot(platform, ownerId, scope);
        const refresh = async () => {
            if (!this.pending.has(key)) {
                const task = this.withSlot(() => this.refresh(bot, platform, ownerId, scope, args.kind, args.groupId));
                this.pending.set(key, task);
                void task.finally(() => this.pending.delete(key)).catch(() => {});
            }
            await this.pending.get(key);
            return this.snapshot(platform, ownerId, scope);
        };
        if (args.refresh || !current?.revision) current = await refresh();
        for (let attempt = 0; attempt < 3; attempt++) {
            this.ensureActive();
            if (!current?.revision) throw new Error("名单尚未建立");
            const result = await this.readRevision(current, args);
            const complete = await this.contactCount(current);
            const latest = await this.snapshot(platform, ownerId, scope);
            // Even an exact lookup miss must be retried if its revision was retired
            // during the read. Never return a mixture of pages or a deleted cache.
            if (latest?.revision === current.revision) {
                if (complete === current.total) return result;
                // Repair only a broken cache, never expire a complete published
                // snapshot. This also recovers legacy dangling pointers.
                current = await refresh();
            } else current = latest;
        }
        throw new Error("名单在查询期间持续更新，请稍后重试");
    }

    private async readRevision(current: Snapshot, args: Query) {
        const { platform, ownerId, scope, revision } = current;
        const offset = args.offset || 0;
        const limit = args.all ? Math.max(0, current.total - offset) : args.limit ?? 50;
        const entries: Contact[] = [];
        if (!args.summaryOnly) {
            if (args.userId) {
                entries.push(...await this.ctx.database.get(CONTACTS,
                    { platform, ownerId, scope, revision, userId: args.userId }, { limit: 1 }));
            } else {
                // All reads, including all=true, use bounded DB pages.
                for (let start = offset; start < Math.min(current.total, offset + limit); start += this.batchSize) {
                    const page = await this.ctx.database.get(CONTACTS, { platform, ownerId, scope, revision },
                        { sort: { ordinal: "asc" }, offset: start, limit: Math.min(this.batchSize, offset + limit - start) });
                    entries.push(...page);
                    if (!page.length) break;
                }
            }
        }
        return { kind: args.kind, groupId: args.kind === "members" ? args.groupId : undefined,
            fetchedAt: current.fetchedAt, sourceBotId: current.sourceBotId, total: current.total,
            offset: args.userId || args.summaryOnly ? 0 : offset, returned: entries.length, entries };
    }

    private contactCount(snapshot: Pick<Snapshot, "platform" | "ownerId" | "scope" | "revision">) {
        const { platform, ownerId, scope, revision } = snapshot;
        return this.ctx.database.eval(CONTACTS, row => $.count(row.userId), { platform, ownerId, scope, revision });
    }

    private async cleanup(platform: string, ownerId: string, scope: string) {
        const database = this.ctx.database;
        // The exclusion is evaluated inside the DELETE, not from a stale JS
        // snapshot. Readers and publishers additionally verify counts to handle
        // a preparation crossing the TTL/publication boundary.
        await database.remove(CONTACTS, row => $.and(
            $.eq(row.platform, platform), $.eq(row.ownerId, ownerId), $.eq(row.scope, scope),
            $.lt(row.revisionCreatedAt, new Date(Date.now() - REVISION_TTL_MS)),
            $.not($.in(row.revision, database.select(SNAPSHOTS, { platform, ownerId, scope }).evaluate("revision"))),
        )).catch(error => this.ctx.logger.warn("清理旧名单失败：%s", String(error)));
    }

    private async refresh(bot: OneBotClient, platform: string, ownerId: string, scope: string, kind: Query["kind"], groupId?: string) {
        const raw = kind === "friends" ? await bot.internal.getFriendList() : await bot.internal.getGroupMemberList(groupId!, true);
        this.ensureActive();
        if (!Array.isArray(raw)) throw new Error("OneBot 返回了无效的名单");
        const previous = await this.snapshot(platform, ownerId, scope);
        const revision = randomUUID();
        const revisionCreatedAt = new Date(Date.now());
        const seen = new Set<string>();
        const entries: Contact[] = [];
        for (const row of raw) {
            const userId = String(row.user_id ?? "");
            if (!userId || seen.has(userId)) continue;
            seen.add(userId);
            entries.push({ platform, ownerId, scope, revision, revisionCreatedAt, userId, ordinal: entries.length,
                nickname: String(row.nickname ?? ""), remark: String(row.remark ?? ""),
                card: String(row.card ?? ""), role: String(row.role ?? "") });
        }
        let publicationStarted = false;
        try {
            for (let i = 0; i < entries.length; i += this.batchSize) {
                this.ensureActive();
                await this.ctx.database.upsert(CONTACTS, entries.slice(i, i + this.batchSize));
            }
            this.ensureActive();
            // Some Koishi drivers implement set() as SELECT + UPSERT, so a
            // conditional set is not a publication lock. Check both sides of
            // publication instead; queries independently verify completeness.
            const expected = { platform, ownerId, scope, revision };
            if (await this.contactCount(expected) !== entries.length)
                throw new Error("名单准备期间已过期，请重新刷新");
            this.ensureActive();
            publicationStarted = true;
            await this.ctx.database.upsert(SNAPSHOTS, [{ ...expected,
                previousRevision: previous?.revision || "", sourceBotId: String(bot.selfId),
                fetchedAt: new Date(Date.now()), total: entries.length }]);
            if (await this.contactCount(expected) !== entries.length)
                throw new Error("名单准备期间已过期，请重新刷新");
        } catch (error) {
            // A rejected write may already have committed. Once publication
            // starts, leave the candidate to pointer-aware TTL cleanup, so a
            // transient post-publication error cannot erase a complete cache.
            if (!publicationStarted)
                await this.ctx.database.remove(CONTACTS, { platform, ownerId, scope, revision }).catch(() => {});
            throw error;
        }
        await this.cleanup(platform, ownerId, scope);
    }
}
