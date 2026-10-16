import { randomUUID } from "node:crypto";

import type { Account, Person, State } from "./store";

export type CatalogFields = "overview" | "structured" | "full";
export interface CatalogArgs {
    action: "list" | "read_many";
    account_ids?: string[];
    all?: boolean;
    query?: string;
    fields?: CatalogFields;
    cursor?: string;
    limit?: number;
}
export interface CatalogResult {
    items: unknown[];
    total: number;
    returned: number;
    hasMore: boolean;
    nextCursor?: string;
    snapshotAt: number;
}
type Entry = { person: Person; accounts: Account[]; item: unknown; fingerprint: string };
type Snapshot = { scope: string; binding: string; args: CatalogArgs; snapshotAt: number; entries: Entry[] };
const restart = () => new Error("Catalog changed or expired; restart the query（请重新查询）");
const accountsFor = (state: State, id: string) =>
    Object.values(state.accounts)
        .filter((a) => a.personId === id)
        .sort((a, b) => a.userId.localeCompare(b.userId));
const fingerprint = (person: Person, accounts: Account[]) => JSON.stringify([person, accounts]);
const freeze = <T>(value: T): T => {
    if (value && typeof value === "object") {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
};

/** Read-only, scope-bound profile snapshots. Cursor-only continuations inherit immutable query options. */
export class PeopleCatalog {
    private snapshots = new Map<string, Snapshot>();
    private options: { ttlMs: number; maxSnapshots: number; maxBytes: number; maxPageSize: number; now: () => number };
    constructor(options: Partial<PeopleCatalog["options"]> = {}) {
        this.options = { ttlMs: 300_000, maxSnapshots: 32, maxBytes: 24_000, maxPageSize: 20, now: Date.now, ...options };
        for (const key of ["ttlMs", "maxSnapshots", "maxBytes", "maxPageSize"] as const)
            if (!Number.isSafeInteger(this.options[key]) || this.options[key] < 1) throw new Error("Invalid catalog bounds");
        this.options.maxPageSize = Math.min(20, this.options.maxPageSize);
    }
    async query(
        scope: string,
        args: CatalogArgs,
        read: () => Promise<State>,
        canRead: (person: Person, accounts: Account[]) => boolean | Promise<boolean>,
        project: (person: Person, accounts: Account[], fields: CatalogFields) => unknown | Promise<unknown>,
    ): Promise<CatalogResult> {
        if (!scope || !args || !["list", "read_many"].includes(args.action)) throw new Error("Invalid catalog action");
        if (args.cursor !== undefined) {
            if (typeof args.cursor !== "string") throw new Error("Invalid cursor");
            const match = /^([\da-f-]{36}):(\d+)$/.exec(args.cursor);
            if (!match) throw new Error("Invalid cursor");
            const snapshot = this.snapshots.get(match[1]);
            if (!snapshot || this.options.now() - snapshot.snapshotAt >= this.options.ttlMs) throw restart();
            if (snapshot.scope !== scope || snapshot.args.action !== args.action) throw new Error("cursor scope/action mismatch");
            args = { ...snapshot.args, ...Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) };
        }
        const fields = args.fields ?? "overview";
        if (!["overview", "structured", "full"].includes(fields)) throw new Error("Invalid fields");
        if (args.query !== undefined && typeof args.query !== "string") throw new Error("Invalid query");
        if (args.all !== undefined && typeof args.all !== "boolean") throw new Error("Invalid all selector");
        if (
            args.account_ids !== undefined &&
            (!Array.isArray(args.account_ids) || !args.account_ids.length || args.account_ids.some((id) => typeof id !== "string" || !id))
        )
            throw new Error("Invalid account_ids");
        if (args.all && args.account_ids) throw new Error("all and account_ids are mutually exclusive");
        if (args.action === "list" && (args.all || args.account_ids)) throw new Error("list does not accept selection");
        if (args.action === "read_many" && !args.all && !args.account_ids) throw new Error("Select account_ids or all");
        const limit = args.limit ?? this.options.maxPageSize;
        if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid page limit");
        const pageSize = Math.min(limit, this.options.maxPageSize);
        const binding = JSON.stringify([args.action, [...new Set(args.account_ids ?? [])].sort(), !!args.all, args.query ?? "", fields]);
        const now = this.options.now();
        for (const [id, snapshot] of this.snapshots) if (now - snapshot.snapshotAt >= this.options.ttlMs) this.snapshots.delete(id);
        let snapshot: Snapshot;
        let id: string;
        let offset = 0;
        if (args.cursor !== undefined) {
            if (typeof args.cursor !== "string") throw new Error("Invalid cursor");
            const match = /^([\da-f-]{36}):(\d+)$/.exec(args.cursor);
            if (!match) throw new Error("Invalid cursor");
            id = match[1];
            offset = Number(match[2]);
            const existing = this.snapshots.get(id);
            if (!existing) throw restart();
            if (existing.scope !== scope || existing.binding !== binding) throw new Error("cursor scope/query/fields mismatch");
            if (!Number.isSafeInteger(offset) || offset < 1 || offset >= existing.entries.length) throw new Error("Invalid cursor offset");
            snapshot = existing;
        } else {
            id = randomUUID();
            const state = structuredClone(await read());
            if (state.settings.mode === "off") throw new Error("人物读取已关闭 (off)");
            const selected = new Map<string, Person>();
            if (args.account_ids) {
                for (const ref of args.account_ids) {
                    const account = Object.values(state.accounts).find((a) => a.userId === ref);
                    const personId = account?.personId ?? ref;
                    const person = Object.hasOwn(state.people, personId) ? state.people[personId] : undefined;
                    if (!person) throw new Error("Unknown person/account（不存在）");
                    selected.set(person.id, person);
                }
            } else for (const person of Object.values(state.people)) selected.set(person.id, person);
            const entries: Entry[] = [];
            for (const person of [...selected.values()].sort((a, b) => a.id.localeCompare(b.id))) {
                const accounts = accountsFor(state, person.id);
                if (!(await canRead(structuredClone(person), structuredClone(accounts)))) {
                    if (args.account_ids) throw new Error("Permission denied（无权限）");
                    continue;
                }
                if (args.query && !person.name.toLocaleLowerCase().includes(args.query.toLocaleLowerCase())) continue;
                const item = structuredClone(await project(structuredClone(person), structuredClone(accounts), fields));
                // Validate that project returns a serializable result and never retain its mutable references.
                if (JSON.stringify(item) === undefined) throw new Error("Invalid catalog projection");
                entries.push(freeze({ person, accounts, item, fingerprint: fingerprint(person, accounts) }));
            }
            snapshot = freeze({ scope, binding, args: structuredClone({ ...args, fields }), snapshotAt: now, entries });
        }
        // Re-read after all asynchronous projection/permission work. Any selected revision,
        // stale marker, binding, profile, or permission change invalidates the whole snapshot.
        const validate = async () => {
            const current = structuredClone(await read());
            if (current.settings.mode === "off") throw new Error("人物读取已关闭 (off)");
            for (const entry of snapshot.entries) {
                const person = Object.hasOwn(current.people, entry.person.id) ? current.people[entry.person.id] : undefined;
                const accounts = accountsFor(current, entry.person.id);
                if (!person || fingerprint(person, accounts) !== entry.fingerprint || !(await canRead(structuredClone(person), structuredClone(accounts)))) {
                    this.snapshots.delete(id);
                    throw restart();
                }
            }
            // A permission callback can itself yield while a correction commits.
            // Check a fresh state after those awaits before releasing cached content.
            const latest = structuredClone(await read());
            if (latest.settings.mode === "off") throw new Error("人物读取已关闭 (off)");
            for (const entry of snapshot.entries) {
                const person = Object.hasOwn(latest.people, entry.person.id) ? latest.people[entry.person.id] : undefined;
                if (!person || fingerprint(person, accountsFor(latest, entry.person.id)) !== entry.fingerprint) {
                    this.snapshots.delete(id);
                    throw restart();
                }
            }
        };
        await validate();
        const items: unknown[] = [];
        const result = (): CatalogResult => {
            const end = offset + items.length;
            const hasMore = end < snapshot.entries.length;
            return {
                items,
                total: snapshot.entries.length,
                returned: items.length,
                hasMore,
                ...(hasMore ? { nextCursor: `${id}:${end}` } : {}),
                snapshotAt: snapshot.snapshotAt,
            };
        };
        for (const entry of snapshot.entries.slice(offset, offset + pageSize)) {
            items.push(structuredClone(entry.item));
            if (Buffer.byteLength(JSON.stringify(result()), "utf8") > this.options.maxBytes) {
                items.pop();
                if (!items.length) throw new Error("Single catalog item too large（单个档案过大，请选择更少字段）");
                break;
            }
        }
        // Final permission checks include the caller's session policy on every page.
        await validate();
        if (this.options.now() - snapshot.snapshotAt >= this.options.ttlMs) throw restart();
        if (!this.snapshots.has(id)) {
            while (this.snapshots.size >= this.options.maxSnapshots) this.snapshots.delete(this.snapshots.keys().next().value!);
            this.snapshots.set(id, snapshot);
        }
        return result();
    }
}
