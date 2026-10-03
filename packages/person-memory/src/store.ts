import { createHash, randomUUID } from "node:crypto";
import type { Context } from "koishi";

export type Mode = "off" | "review" | "auto";
export interface SceneInput { platform: string; selfId?: string; bot?: { selfId: string }; channelId: string; userId: string; isDirect?: boolean }
export function sceneKey(s: SceneInput): string {
    const bot = s.selfId || s.bot?.selfId;
    const channel = s.isDirect ? s.userId : s.channelId;
    if (!s.platform || !bot || !channel || !s.userId) throw new Error("会话缺少平台、机器人或场景 ID");
    return digest(JSON.stringify([s.platform, bot, s.isDirect ? "private" : "channel", channel]));
}
function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
export interface Evidence { id: string; userId: string; name: string; text: string; timestamp: number }
export interface Person { id: string; name: string; provisional: boolean; profile: string; evidence: Evidence[]; locked: boolean; stale: boolean; revision: number; identityChanged?: boolean; identityChangedAt?: number }
export interface Account { userId: string; name: string; personId: string; confidence: number; revision: number }
export interface Proposal { id: string; userId: string; personId: string; personRevision: number; accountRevision: number; profile: string; evidence: Evidence[]; createdAt: number }
export interface LinkProposal { id: string; userId: string; sourcePersonId: string; sourcePersonRevision: number; accountRevision: number; targetPersonId: string; targetPersonRevision: number; confidence: number; reason: string; evidence: Evidence[]; createdAt: number }
export interface State { people: Record<string, Person>; accounts: Record<string, Account>; proposals: Record<string, Proposal>; linkProposals: Record<string, LinkProposal>; settings: { mode: Mode; paused: boolean } }
export interface HistoryFilter { offset?: number; userId?: string; personId?: string; action?: string }
interface StateRow { scope: string; revision: number; state: State }
interface SourceRow { key: string; scope: string; userId: string; timestamp: number; source: Evidence }
export interface Change { collection: keyof State; key: string; before: unknown; after: unknown }
export interface Audit { baseline?: { revision: number; state: State }; format?: number; id: string; scope: string; timestamp: number; revision: number; actor: string; action: string; changes: Change[] }
declare module "koishi" {
    interface Tables { "person_memory.state": StateRow; "person_memory.sources": SourceRow; "person_memory.audit": Audit }
}
const STATE = "person_memory.state", SOURCE = "person_memory.sources", AUDIT = "person_memory.audit";
export function registerModels(ctx: Context) {
    ctx.model.extend(STATE, { scope: "string", revision: "unsigned", state: "json" }, { primary: "scope" });
    ctx.model.extend(SOURCE, { key: "string", scope: "string", userId: "string", timestamp: "double", source: "json" }, { primary: "key" });
    ctx.model.extend(AUDIT, { baseline: "json", format: "unsigned", id: "string", scope: "string", timestamp: "double", revision: "unsigned", actor: "string", action: "string", changes: "json" }, { primary: "id" });
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function empty(mode: Mode): State { return { people: {}, accounts: {}, proposals: {}, linkProposals: {}, settings: { mode, paused: false } }; }
function normalize(state: State): State { state.linkProposals ||= {}; return state; }
function changes(before: State, after: State): Change[] {
    const result: Change[] = [];
    for (const collection of ["people", "accounts", "proposals", "linkProposals", "settings"] as const) {
        const a = before[collection] || {}, b = after[collection] || {};
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
            const prev = (a as any)[key] ?? null, next = (b as any)[key] ?? null;
            if (!equal(prev, next)) result.push({ collection, key, before: prev, after: next });
        }
    }
    return result;
}
function validate(state: State) {
    for (const account of Object.values(state.accounts)) if (!Object.hasOwn(state.people, account.personId)) throw new Error("关联引用了不存在的人物");
    for (const proposal of Object.values(state.proposals)) if (!Object.hasOwn(state.people, proposal.personId)) throw new Error("候选引用了不存在的人物");
    for (const proposal of Object.values(state.linkProposals)) if (!Object.hasOwn(state.people, proposal.sourcePersonId) || !Object.hasOwn(state.people, proposal.targetPersonId)) throw new Error("关联候选引用了不存在的人物");
    if (Object.keys(state.accounts).length > 2000 || Object.keys(state.people).length > 2000) throw new Error("当前场景超过 2000 个档案，请用 people.archive 归档不再活跃的人物后重试");
}
function text(value: string, limit: number, label: string) {
    if (typeof value !== "string" || !value.trim() || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`${label}为空、过长或含控制字符`);
    return value.trim();
}
function person(state: State, ref: string) {
    const account = state.accounts[digest(ref)];
    const target = account ? state.people[account.personId] : Object.hasOwn(state.people, ref) ? state.people[ref] : undefined;
    if (!target) throw new Error("当前场景查无此人，请先查看或绑定账号");
    return target;
}
function account(state: State, id: string) {
    const target = state.accounts[digest(id)];
    if (!target) throw new Error("当前场景没有此账号关联");
    return target;
}
function createPerson(name: string): Person { return { id: randomUUID(), name: text(name, 80, "称呼"), provisional: true, profile: "", evidence: [], locked: false, stale: false, revision: 0 }; }
function invalidate(state: State, p: Person) {
    if (p.profile) p.stale = true;
    p.identityChanged = true;
    p.identityChangedAt = Date.now();
    p.revision++;
    for (const [id, candidate] of Object.entries(state.proposals)) if (candidate.personId === p.id) delete state.proposals[id];
    for (const [id, candidate] of Object.entries(state.linkProposals)) if (candidate.sourcePersonId === p.id || candidate.targetPersonId === p.id) delete state.linkProposals[id];
}
function bindAccount(state: State, userId: string, p: Person, confidence: number) {
    let a = state.accounts[digest(userId)];
    if (a && a.personId !== p.id) { invalidate(state, state.people[a.personId]); invalidate(state, p); }
    else if (!a) invalidate(state, p);
    if (!a) a = state.accounts[digest(userId)] = { userId, name: userId, personId: p.id, confidence, revision: 0 };
    a.personId = p.id; a.confidence = confidence; a.revision++; p.provisional = false;
    return a;
}
class Conflict extends Error {}
// Reduce contention between local instances. Correctness comes from the unique
// commit INSERT, never from this local lock or Minato set() (not a SQLite CAS).
const locks = new WeakMap<object, Map<string, Promise<void>>>();
async function serial<T>(db: object, key: string, fn: () => Promise<T>): Promise<T> {
    let map = locks.get(db);
    if (!map) locks.set(db, map = new Map());
    const previous = map.get(key) || Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>(resolve => { release = resolve; });
    map.set(key, tail);
    await previous;
    try { return await fn(); }
    finally { release(); if (map.get(key) === tail) map.delete(key); }
}

export class PersonStore {
    constructor(private db: Context["database"], private defaultMode: Mode) {}
    private async snapshot(scope: string): Promise<StateRow & { firstCommit: boolean }> {
        const cached = (await this.db.get(STATE, { scope }))[0];
        const first = (await this.db.get(AUDIT, { scope, format: 1 }, { sort: { revision: "asc" }, limit: 1 }))[0];
        const baseline = first?.baseline;
        const useBaseline = baseline?.state && (!cached || cached.revision < baseline.revision);
        const row = { scope, revision: useBaseline ? baseline.revision : cached?.revision || 0,
            state: normalize(structuredClone(useBaseline ? baseline.state : cached?.state || empty(this.defaultMode))), firstCommit: !first };
        const commits = await this.db.get(AUDIT, { scope, format: 1, revision: { $gt: row.revision } }, { sort: { revision: "asc" } });
        for (const commit of commits) {
            if (commit.revision !== row.revision + 1) throw new Error("人物提交日志不连续，请恢复完整数据库备份");
            for (const change of commit.changes) {
                const collection = row.state[change.collection] as any;
                if (change.after === null) delete collection[change.key];
                else collection[change.key] = structuredClone(change.after);
            }
            row.revision = commit.revision;
        }
        row.firstCommit = !first && !commits.length;
        if (row.revision && (!cached || cached.revision !== row.revision)) await this.cache({ scope, revision: row.revision, state: row.state });
        return row;
    }
    async read(scope: string): Promise<State> { return (await this.snapshot(scope)).state; }
    private async cache(row: StateRow) {
        // A stale whole-row snapshot is safe: readers replay all later commits.
        // Cache failure must not turn an accepted, audited commit into a failure.
        try {
            const result = await this.db.set(STATE, { scope: row.scope }, { revision: row.revision, state: row.state });
            if (!result.matched) await this.db.create(STATE, row);
        } catch { /* Disposable projection; retry on the next successful edit. */ }
    }
    private async edit<T>(scope: string, actor: string, action: string, fn: (state: State, db: Context["database"]) => T | Promise<T>, active = () => true): Promise<T> {
        return serial(this.db, scope, async () => {
            for (let attempt = 0; attempt < 16; attempt++) {
                const row = await this.snapshot(scope);
                if (!active()) throw new Error("任务已取消");
                const state = normalize(structuredClone(row.state));
                const result = await fn(state, this.db);
                // Revisions never roll back, including after undo and recreation.
                for (const collection of ["people", "accounts"] as const) {
                    for (const [id, value] of Object.entries(state[collection])) {
                        if (!equal(value, row.state[collection][id])) value.revision = row.revision + 1;
                    }
                }
                validate(state);
                const delta = changes(row.state, state);
                if (!active()) throw new Error("任务已取消");
                if (!delta.length) return structuredClone(result);
                if (!row.revision) {
                    // The first commit must also preserve defaults if its cache is
                    // lost and the plugin restarts with a different default mode.
                    for (const key of ["mode", "paused"] as const) if (!delta.some(c => c.collection === "settings" && c.key === key)) {
                        delta.push({ collection: "settings", key, before: row.state.settings[key], after: state.settings[key] });
                    }
                }
                const revision = row.revision + 1;
                const id = `commit:${digest(JSON.stringify([scope, revision]))}`;
                try {
                    // One INSERT is both the accepted state delta and its audit.
                    // Cancellation is checked before dispatch; once inserted, the
                    // operation is accepted even if disposal races its completion.
                    await this.db.create(AUDIT, { id, format: 1, scope, revision, timestamp: Date.now(), actor, action, changes: delta,
                        // Capture legacy state in the same atomic INSERT. It is not
                        // an audit change and must not affect conditional revert.
                        ...(row.firstCommit && row.revision ? { baseline: { revision: row.revision, state: row.state } } : {}),
                    });
                } catch (error) {
                    const winner = (await this.db.get(AUDIT, { id }))[0];
                    if (!winner || winner.format !== 1 || winner.scope !== scope || winner.revision !== revision) throw error;
                    if (attempt === 15) throw new Conflict("状态被同时修改，请重试");
                    continue;
                }
                await this.cache({ scope, revision, state });
                return structuredClone(result);
            }
            throw new Conflict("状态更新失败");
        });
    }
    async find(scope: string, ref: string) {
        const state = await this.read(scope);
        try { const p = person(state, ref); return { person: p, accounts: Object.values(state.accounts).filter(a => a.personId === p.id) }; }
        catch { return undefined; }
    }
    private async wasArchived(db: Context["database"], scope: string, userId: string) {
        let cursor: number | undefined;
        // Archived state is kept in audits rather than in the capacity-limited
        // scene JSON. Check only archive records, in bounded pages, on first sight.
        while (true) {
            const rows = await db.get(AUDIT, { scope, action: "archive", ...(cursor === undefined ? {} : { revision: { $lt: cursor } }) }, { sort: { revision: "desc" }, limit: 100 });
            if (rows.some(row => row.changes.some(change => change.collection === "accounts" && (change.before as Account | null)?.userId === userId))) return true;
            if (rows.length < 100) return false;
            cursor = rows[rows.length - 1].revision;
        }
    }
    async recognize(scope: string, userId: string, name: string, active = () => true) {
        text(userId, 256, "账号 ID");
        const safeName = (name || userId).slice(0, 80).replace(/[\u0000-\u001f\u007f]/g, " ");
        return this.edit(scope, "harness", "recognize", async (state, db) => {
            let a = state.accounts[digest(userId)];
            if (!a) {
                const p = createPerson(safeName);
                if (await this.wasArchived(db, scope, userId)) invalidate(state, p);
                state.people[p.id] = p;
                a = state.accounts[digest(userId)] = { userId, name: safeName, personId: p.id, confidence: 1, revision: 0 };
            } else a.name = safeName;
            return { person: state.people[a.personId], account: a };
        }, active);
    }
    async capture(scope: string, input: Evidence, active = () => true) {
        const source = { id: text(input.id, 256, "消息 ID"), userId: text(input.userId, 256, "来源账号"), name: String(input.name || "").slice(0, 80), text: String(input.text).slice(0, 1000), timestamp: input.timestamp };
        if (!Number.isFinite(source.timestamp) || !source.text.trim()) return;
        await serial(this.db, scope, async () => {
            const key = digest(JSON.stringify([scope, source.id]));
            if ((await this.db.get(SOURCE, { key })).length) return; // Never rewrite original evidence.
            if (!active()) throw new Error("任务已取消");
            try { await this.db.create(SOURCE, { key, scope, userId: source.userId, timestamp: source.timestamp, source }); }
            catch (error) { if (!(await this.db.get(SOURCE, { key })).length) throw error; }
            // Retention is an idempotent projection cleanup after acceptance. A
            // failed cleanup may temporarily retain extra sources, never undo one.
            try {
                const old = await this.db.get(SOURCE, { scope }, { sort: { timestamp: "desc", key: "desc" }, offset: 200, limit: 2000 });
                if (old.length) await this.db.remove(SOURCE, { key: { $in: old.map(r => r.key) } });
            } catch { /* Retry cleanup on the next captured source. */ }
        });
    }

    async sources(scope: string, userId: string, limit = 20): Promise<Evidence[]> {
        const rows = await this.db.get(SOURCE, { scope, userId }, { sort: { timestamp: "desc", key: "desc" }, limit: Math.min(20, Math.max(1, limit)) });
        return rows.reverse().map(r => r.source);
    }
    async rename(scope: string, ref: string, name: string, actor: string) {
        return this.edit(scope, actor, "rename", state => { const p = person(state, ref); p.name = text(name, 80, "称呼"); p.provisional = false; p.revision++; return p; });
    }
    async create(scope: string, name: string, actor: string) {
        return this.edit(scope, actor, "create", state => { const p = createPerson(name); p.provisional = false; state.people[p.id] = p; return p; });
    }
    async setProfile(scope: string, ref: string, profile: string, actor: string) {
        return this.edit(scope, actor, "profile", state => { const p = person(state, ref); p.profile = profile ? text(profile, 2000, "画像") : ""; p.evidence = []; p.stale = false; p.revision++; return p; });
    }
    async lock(scope: string, ref: string, locked: boolean, actor: string) {
        return this.edit(scope, actor, locked ? "lock" : "unlock", state => { const p = person(state, ref); p.locked = locked; p.revision++; return p; });
    }
    async settings(scope: string, patch: Partial<State["settings"]>, actor: string) {
        if (patch.mode && !["off", "review", "auto"].includes(patch.mode)) throw new Error("模式必须是 off、review 或 auto");
        return this.edit(scope, actor, "settings", state => { Object.assign(state.settings, patch); return state.settings; });
    }
    async bind(scope: string, userId: string, target: string, confidence: number, actor: string) {
        text(userId, 256, "账号 ID");
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("确信度必须在 0 到 1 之间");
        return this.edit(scope, actor, "bind", state => {
            const p = person(state, target);
            return bindAccount(state, userId, p, confidence);
        });
    }
    async split(scope: string, userId: string, name: string, actor: string) {
        return this.edit(scope, actor, "split", state => {
            const a = account(state, userId), old = state.people[a.personId];
            invalidate(state, old);
            const p = createPerson(name); p.provisional = false;
            invalidate(state, p);
            state.people[p.id] = p; a.personId = p.id; a.confidence = 1; a.revision++;
            return p;
        });
    }
    async unbind(scope: string, userId: string, actor: string) {
        // Unbinding starts a fresh provisional person; it cannot erase the old sources.
        return this.edit(scope, actor, "unbind", state => {
            const a = account(state, userId);
            invalidate(state, state.people[a.personId]);
            const p = createPerson(a.name); state.people[p.id] = p;
            invalidate(state, p);
            a.personId = p.id; a.confidence = 1; a.revision++;
            return p;
        });
    }
    async merge(scope: string, from: string, into: string, actor: string) {
        return this.edit(scope, actor, "merge", state => {
            const a = person(state, from), b = person(state, into);
            if (a.id === b.id) throw new Error("不能合并同一个人物");
            if (a.locked || b.locked) throw new Error("请先解锁再合并人物");
            b.profile = [b.profile, a.profile].filter(Boolean).join("\n").slice(0, 2000);
            b.evidence = [...b.evidence, ...a.evidence].slice(0, 20);
            invalidate(state, a); invalidate(state, b); b.provisional = false;
            for (const link of Object.values(state.accounts)) if (link.personId === a.id) { link.personId = b.id; link.revision++; }
            delete state.people[a.id];
            return b;
        });
    }
    async archive(scope: string, ref: string, actor: string, expectedRevision: number) {
        if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error("请先预览人物并提供画像版本");
        return this.edit(scope, actor, "archive", state => {
            const p = person(state, ref);
            if (p.revision !== expectedRevision) throw new Error("人物版本已变化，请重新预览后归档");
            const accounts = Object.values(state.accounts).filter(a => a.personId === p.id);
            for (const a of accounts) delete state.accounts[digest(a.userId)];
            for (const [id, candidate] of Object.entries(state.proposals)) if (candidate.personId === p.id) delete state.proposals[id];
            for (const [id, candidate] of Object.entries(state.linkProposals)) if (candidate.sourcePersonId === p.id || candidate.targetPersonId === p.id) delete state.linkProposals[id];
            delete state.people[p.id];
            return p;
        });
    }
    private async evidence(scope: string, userId: string, messageIds: string[]) {
        if (!Array.isArray(messageIds) || messageIds.length < 1 || messageIds.length > 10 || messageIds.some(id => typeof id !== "string")) throw new Error("需提供 1 到 10 个消息来源 ID");
        const rows = await this.db.get(SOURCE, { scope, userId, key: { $in: [...new Set(messageIds)].map(id => digest(JSON.stringify([scope, id]))) } });
        if (rows.length !== new Set(messageIds).size) throw new Error("消息来源不属于当前场景和账号，或已超出保留范围");
        return rows.map(row => row.source);
    }
    async proposeLink(scope: string, userId: string, targetPersonId: string, confidence: number, reason: string, messageIds: string[], actor: string,
        expected: { personId: string; personRevision: number; accountRevision: number; targetRevision: number }, active = () => true) {
        reason = text(reason, 500, "关联理由");
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("确信度必须在 0 到 1 之间");
        const evidence = await this.evidence(scope, userId, messageIds);
        return this.edit(scope, actor, "link-proposal", state => {
            if (state.settings.paused || state.settings.mode === "off") throw new Error("维护已暂停或关闭");
            const a = account(state, userId), source = state.people[a.personId];
            const target = Object.hasOwn(state.people, targetPersonId) ? state.people[targetPersonId] : undefined;
            if (!target) throw new Error("当前场景不存在目标人物");
            if (source.id === target.id) throw new Error("账号已关联到此人物");
            if (source.locked || target.locked) throw new Error("人物已被管理员锁定");
            if (!expected || source.id !== expected.personId || source.revision !== expected.personRevision || a.revision !== expected.accountRevision || target.revision !== expected.targetRevision) throw new Error("身份或画像版本已变化，关联候选已过期");
            if (Object.keys(state.proposals).length + Object.keys(state.linkProposals).length >= 50) throw new Error("待审核候选已达 50 个，请先处理");
            const candidate: LinkProposal = { id: randomUUID(), userId, sourcePersonId: source.id, sourcePersonRevision: source.revision, accountRevision: a.revision,
                targetPersonId: target.id, targetPersonRevision: target.revision, confidence, reason, evidence, createdAt: Date.now() };
            // Identity beliefs always require a human, including in automatic profile mode.
            state.linkProposals[candidate.id] = candidate;
            return { ...candidate, state: "pending" as const };
        }, active);
    }
    async propose(scope: string, userId: string, profile: string, messageIds: string[], actor: string, expected?: { personId: string; personRevision: number; accountRevision: number }, active = () => true) {
        profile = text(profile, 2000, "画像");
        const sources = await this.evidence(scope, userId, messageIds);
        return this.edit(scope, actor, "proposal", state => {
            if (!active()) throw new Error("任务已取消");
            if (state.settings.paused || state.settings.mode === "off") throw new Error("维护已暂停或关闭");
            const a = account(state, userId), p = state.people[a.personId];
            if (p.locked) throw new Error("画像已被管理员锁定");
            if (expected && (p.id !== expected.personId || p.revision !== expected.personRevision || a.revision !== expected.accountRevision)) throw new Error("总结期间发生人工修改或身份变更，候选已过期");
            if (state.settings.mode !== "auto" && Object.keys(state.proposals).length + Object.keys(state.linkProposals).length >= 50) throw new Error("待审核候选已达 50 个，请先处理");
            const combined = [...sources, ...(p.stale ? [] : p.evidence)];
            const evidence = [...new Map(combined.map(e => [JSON.stringify([e.userId, e.id]), e])).values()].slice(0, 20);
            const proposal: Proposal = { id: randomUUID(), userId, personId: p.id, personRevision: p.revision, accountRevision: a.revision, profile, evidence, createdAt: Date.now() };
            if (state.settings.mode === "auto") this.accept(state, proposal);
            else state.proposals[proposal.id] = proposal;
            return { ...proposal, state: state.settings.mode === "auto" ? "accepted" : "pending" };
        }, active);
    }
    private accept(state: State, proposal: Proposal) {
        const a = account(state, proposal.userId), p = state.people[a.personId];
        if (p.locked) throw new Error("画像已被管理员锁定");
        if (p.id !== proposal.personId || p.revision !== proposal.personRevision || a.revision !== proposal.accountRevision) throw new Error("候选已过期，请重新总结");
        p.profile = proposal.profile; p.evidence = proposal.evidence; p.stale = false; p.revision++;
    }
    async review(scope: string, id: string, approve: boolean, actor: string) {
        return this.edit(scope, actor, approve ? "approve" : "reject", state => {
            const proposal = Object.hasOwn(state.proposals, id) ? state.proposals[id] : undefined;
            if (proposal) {
                if (approve) this.accept(state, proposal);
                delete state.proposals[id];
                return proposal;
            }
            const link = Object.hasOwn(state.linkProposals, id) ? state.linkProposals[id] : undefined;
            if (!link) throw new Error("当前场景没有此候选");
            if (approve) {
                const a = account(state, link.userId), source = state.people[a.personId], target = state.people[link.targetPersonId];
                if (source.id !== link.sourcePersonId || source.revision !== link.sourcePersonRevision || a.revision !== link.accountRevision || !target || target.revision !== link.targetPersonRevision) throw new Error("关联候选已过期，请重新提议");
                if (source.locked || target.locked) throw new Error("请先解锁再接受关联候选");
                bindAccount(state, link.userId, target, link.confidence);
            }
            delete state.linkProposals[id];
            return link;
        });
    }
    async history(scope: string, limit = 10, filter: HistoryFilter = {}) {
        const size = Math.min(20, Math.max(1, Math.floor(limit))), offset = Math.max(0, Math.floor(filter.offset || 0));
        if (!Number.isFinite(size) || !Number.isSafeInteger(offset)) throw new Error("历史分页参数无效");
        const query = { scope, ...(filter.action ? { action: text(filter.action, 80, "操作类型") } : {}) };
        if (!filter.userId && !filter.personId) return this.db.get(AUDIT, query, { sort: { revision: "desc" }, limit: size, offset });
        const personIds = new Set<string>(filter.personId ? [filter.personId] : []);
        if (filter.userId) {
            const current = (await this.read(scope)).accounts[digest(filter.userId)];
            if (current) personIds.add(current.personId);
        }
        const result: Audit[] = [];
        let cursor: number | undefined, skipped = 0;
        // Walk by monotonic revision: entity filters work with historical JSON rows,
        // including records written before this plugin revision, without a migration.
        while (result.length < size) {
            const rows = await this.db.get(AUDIT, { scope, ...(cursor === undefined ? {} : { revision: { $lt: cursor } }) }, { sort: { revision: "desc" }, limit: 100 });
            if (!rows.length) break;
            for (const row of rows) {
                if (filter.userId) for (const change of row.changes) if (change.collection === "accounts") {
                    for (const value of [change.before, change.after] as (Account | null)[]) if (value?.userId === filter.userId) personIds.add(value.personId);
                }
                const matched = row.changes.some(change => (change.collection === "people" && personIds.has(change.key)) || [change.before, change.after].some(value => {
                    const item = value as Partial<Account & Proposal & LinkProposal> | null;
                    return !!item && ((!!filter.userId && item.userId === filter.userId) || [item.personId, item.sourcePersonId, item.targetPersonId].some(id => !!id && personIds.has(id)));
                }));
                if (!matched || (filter.action && row.action !== filter.action)) continue;
                if (skipped++ < offset) continue;
                result.push(row);
                if (result.length === size) break;
            }
            cursor = rows[rows.length - 1].revision;
        }
        return result;
    }
    async audit(scope: string, id: string) { return (await this.db.get(AUDIT, { scope, id }))[0]; }
    async revert(scope: string, id: string, actor: string) {
        const record = (await this.db.get(AUDIT, { scope, id }))[0];
        if (!record) throw new Error("当前场景没有此历史记录");
        return this.edit(scope, actor, `revert:${id}`, state => {
            const corrected = new Map(Object.values(state.people).filter(p => p.identityChanged).map(p => [p.id, p.identityChangedAt]));
            const remapped = new Set<string>();
            for (const change of record.changes) if (change.collection === "accounts") {
                for (const value of [change.before, change.after] as (Account | null)[]) if (value) remapped.add(value.personId);
            }
            for (const change of record.changes) {
                const collection = state[change.collection] as any;
                if (!equal(collection[change.key] ?? null, change.after)) throw new Error("存在后续修改，不能直接回滚；请查看差异后手动修正");
            }
            for (const change of record.changes) {
                const collection = state[change.collection] as any;
                if (change.before === null) delete collection[change.key];
                else collection[change.key] = structuredClone(change.before);
            }
            // Do not recycle versions: in-flight summaries must stay stale after undo.
            for (const change of record.changes) if (change.collection === "people" || change.collection === "accounts") {
                const collection = state[change.collection] as any;
                if (collection[change.key]) collection[change.key].revision = Math.max((change.before as any)?.revision || 0, (change.after as any)?.revision || 0) + 1;
            }
            for (const [id, proposal] of Object.entries(state.proposals)) {
                const a = state.accounts[digest(proposal.userId)];
                if (!a || a.personId !== proposal.personId || !Object.hasOwn(state.people, proposal.personId)) delete state.proposals[id];
            }
            for (const [id, proposal] of Object.entries(state.linkProposals)) {
                const a = state.accounts[digest(proposal.userId)];
                if (!a || a.personId !== proposal.sourcePersonId || !Object.hasOwn(state.people, proposal.sourcePersonId) || !Object.hasOwn(state.people, proposal.targetPersonId)) delete state.linkProposals[id];
            }
            // Undo changes current beliefs; it cannot erase the fact that older
            // L2/L3 memories may have been formed under a different identity.
            for (const p of Object.values(state.people)) if (corrected.has(p.id) || remapped.has(p.id)) {
                p.identityChanged = true;
                p.identityChangedAt = remapped.has(p.id) ? Date.now() : corrected.get(p.id);
            }
            return record;
        });
    }
}
