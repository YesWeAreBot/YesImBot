import { randomUUID } from "node:crypto";
import type { Context } from "koishi";

export const SNAPSHOTS = "yesimbot.onebot_directory_snapshots" as const;
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
        ordinal: "unsigned", nickname: "string(255)", remark: "string(255)", card: "string(255)", role: "string(32)",
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

/** One instance per plugin; snapshots change only after an explicit refresh. */
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
        let current = await this.snapshot(platform, ownerId, scope);
        if (args.refresh || !current) {
            if (!this.pending.has(key)) {
                const task = this.withSlot(() => this.refresh(bot, platform, ownerId, scope, args.kind, args.groupId));
                this.pending.set(key, task);
                void task.finally(() => this.pending.delete(key)).catch(() => {});
            }
            await this.pending.get(key);
            current = await this.snapshot(platform, ownerId, scope);
        }
        if (!current) throw new Error("名单尚未建立");
        const offset = args.offset || 0;
        const limit = args.all ? Math.max(0, current.total - offset) : args.limit ?? 50;
        const entries: Contact[] = [];
        if (args.summaryOnly) {
            return { kind: args.kind, groupId: args.kind === "members" ? args.groupId : undefined,
                fetchedAt: current.fetchedAt, sourceBotId: current.sourceBotId, total: current.total, offset: 0, returned: 0, entries };
        }
        if (args.userId) {
            const found = await this.ctx.database.get(CONTACTS, { platform, ownerId, scope, revision: current.revision, userId: args.userId }, { limit: 1 });
            entries.push(...found);
            return { kind: args.kind, groupId: args.kind === "members" ? args.groupId : undefined,
                fetchedAt: current.fetchedAt, sourceBotId: current.sourceBotId, total: current.total, offset: 0, returned: entries.length, entries };
        }
        // Koishi's get() supports pagination; even all=true does not issue an unbounded DB query.
        for (let start = offset; start < Math.min(current.total, offset + limit); start += this.batchSize) {
            const page = await this.ctx.database.get(CONTACTS,
                { platform, ownerId, scope, revision: current.revision },
                { sort: { ordinal: "asc" }, offset: start, limit: Math.min(this.batchSize, offset + limit - start) });
            entries.push(...page);
            if (page.length === 0) break;
        }
        return { kind: args.kind, groupId: args.kind === "members" ? args.groupId : undefined,
            fetchedAt: current.fetchedAt, sourceBotId: current.sourceBotId, total: current.total, offset, returned: entries.length, entries };
    }

    private async refresh(bot: OneBotClient, platform: string, ownerId: string, scope: string, kind: Query["kind"], groupId?: string) {
        const raw = kind === "friends" ? await bot.internal.getFriendList() : await bot.internal.getGroupMemberList(groupId!, true);
        this.ensureActive();
        if (!Array.isArray(raw)) throw new Error("OneBot 返回了无效的名单");
        const previous = await this.snapshot(platform, ownerId, scope);
        const revision = randomUUID();
        const seen = new Set<string>();
        const entries: Contact[] = [];
        for (const row of raw) {
            const userId = String(row.user_id ?? "");
            if (!userId || seen.has(userId)) continue;
            seen.add(userId);
            entries.push({ platform, ownerId, scope, revision, userId, ordinal: entries.length,
                nickname: String(row.nickname ?? ""), remark: String(row.remark ?? ""),
                card: String(row.card ?? ""), role: String(row.role ?? "") });
        }
        try {
            for (let i = 0; i < entries.length; i += this.batchSize) {
                this.ensureActive();
                await this.ctx.database.upsert(CONTACTS, entries.slice(i, i + this.batchSize));
            }
            this.ensureActive();
            await this.ctx.database.upsert(SNAPSHOTS,
                [{ platform, ownerId, scope, revision, previousRevision: previous?.revision || "", sourceBotId: String(bot.selfId), fetchedAt: new Date(), total: entries.length }]);
        } catch (error) {
            await this.ctx.database.remove(CONTACTS, { platform, ownerId, scope, revision }).catch(() => {});
            throw error;
        }
        // Keep the previous generation for in-flight readers; clean older versions.
        await this.ctx.database.remove(CONTACTS, { platform, ownerId, scope, revision: { $nin: [revision, previous?.revision || ""] } })
            .catch(error => this.ctx.logger.warn("清理旧名单失败：%s", String(error)));
    }
}
