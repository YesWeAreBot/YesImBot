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
export interface Person { id: string; name: string; provisional: boolean; profile: string; evidence: Evidence[]; locked: boolean; stale: boolean; revision: number }
export interface Account { userId: string; name: string; personId: string; confidence: number; revision: number }
export interface Proposal { id: string; userId: string; personId: string; personRevision: number; accountRevision: number; profile: string; evidence: Evidence[]; createdAt: number }
export interface State { people: Record<string, Person>; accounts: Record<string, Account>; proposals: Record<string, Proposal>; settings: { mode: Mode; paused: boolean } }
interface StateRow { scope: string; revision: number; state: State }
interface SourceRow { key: string; scope: string; userId: string; timestamp: number; source: Evidence }
export interface Change { collection: keyof State; key: string; before: unknown; after: unknown }
export interface Audit { id: string; scope: string; timestamp: number; revision: number; actor: string; action: string; changes: Change[] }
declare module "koishi" {
    interface Tables { "person_memory.state": StateRow; "person_memory.sources": SourceRow; "person_memory.audit": Audit }
}
const STATE = "person_memory.state", SOURCE = "person_memory.sources", AUDIT = "person_memory.audit";
export function registerModels(ctx: Context) {
    ctx.model.extend(STATE, { scope: "string", revision: "unsigned", state: "json" }, { primary: "scope" });
    ctx.model.extend(SOURCE, { key: "string", scope: "string", userId: "string", timestamp: "double", source: "json" }, { primary: "key" });
    ctx.model.extend(AUDIT, { id: "string", scope: "string", timestamp: "double", revision: "unsigned", actor: "string", action: "string", changes: "json" }, { primary: "id" });
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function empty(mode: Mode): State { return { people: {}, accounts: {}, proposals: {}, settings: { mode, paused: false } }; }
function changes(before: State, after: State): Change[] {
    const result: Change[] = [];
    for (const collection of ["people", "accounts", "proposals", "settings"] as const) {
        const a = before[collection], b = after[collection];
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
    if (Object.keys(state.accounts).length > 2000 || Object.keys(state.people).length > 2000) throw new Error("当前场景超过 2000 个档案，请分批清理或升级存储方案");
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
    p.revision++;
    for (const [id, candidate] of Object.entries(state.proposals)) if (candidate.personId === p.id) delete state.proposals[id];
}
class Conflict extends Error {}
// Serialize transactions on the same driver, including separate plugin instances. CAS
// also prevents a remote writer from silently replacing a newer scene revision.
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
    async read(scope: string): Promise<State> {
        return structuredClone((await this.db.get(STATE, { scope }))[0]?.state || empty(this.defaultMode));
    }
    private async edit<T>(scope: string, actor: string, action: string, fn: (state: State) => T, active = () => true): Promise<T> {
        return serial(this.db, "state", async () => {
            for (let attempt = 0; attempt < 4; attempt++) {
                try {
                    return await this.db.transact(async db => {
                        let row = (await db.get(STATE, { scope }))[0];
                        if (!row) row = await db.create(STATE, { scope, revision: 0, state: empty(this.defaultMode) });
                        if (!active()) throw new Error("任务已取消");
                        const state = structuredClone(row.state);
                        const result = fn(state);
                        // Scene revisions never roll back. Using their next value for all
                        // changed entities prevents ABA after an account/person is removed
                        // by undo and recreated with the same external account ID.
                        for (const collection of ["people", "accounts"] as const) {
                            for (const [id, value] of Object.entries(state[collection])) {
                                if (!equal(value, row.state[collection][id])) value.revision = row.revision + 1;
                            }
                        }
                        validate(state);
                        const delta = changes(row.state, state);
                        if (!delta.length) return structuredClone(result);
                        const write = await db.set(STATE, { scope, revision: row.revision }, { revision: row.revision + 1, state });
                        if (write.matched !== 1) throw new Conflict("状态被同时修改，请重试");
                        await db.create(AUDIT, { id: randomUUID(), scope, revision: row.revision + 1, timestamp: Date.now(), actor, action, changes: delta });
                        if (!active()) throw new Error("任务已取消"); // Abort inside the transaction, including during awaited audit writes.
                        return structuredClone(result);
                    });
                } catch (error) {
                    if (!(error instanceof Conflict) || attempt === 3) throw error;
                }
            }
            throw new Conflict("状态更新失败");
        });
    }
    async find(scope: string, ref: string) {
        const state = await this.read(scope);
        try { const p = person(state, ref); return { person: p, accounts: Object.values(state.accounts).filter(a => a.personId === p.id) }; }
        catch { return undefined; }
    }
    async recognize(scope: string, userId: string, name: string) {
        text(userId, 256, "账号 ID");
        const safeName = (name || userId).slice(0, 80).replace(/[\u0000-\u001f\u007f]/g, " ");
        return this.edit(scope, "harness", "recognize", state => {
            let a = state.accounts[digest(userId)];
            if (!a) {
                const p = createPerson(safeName);
                state.people[p.id] = p;
                a = state.accounts[digest(userId)] = { userId, name: safeName, personId: p.id, confidence: 1, revision: 0 };
            } else a.name = safeName;
            return { person: state.people[a.personId], account: a };
        });
    }
    async capture(scope: string, input: Evidence) {
        const source = { id: text(input.id, 256, "消息 ID"), userId: text(input.userId, 256, "来源账号"), name: String(input.name || "").slice(0, 80), text: String(input.text).slice(0, 1000), timestamp: input.timestamp };
        if (!Number.isFinite(source.timestamp) || !source.text.trim()) return;
        await serial(this.db, "state", async () => {
            const key = digest(JSON.stringify([scope, source.id]));
            if ((await this.db.get(SOURCE, { key })).length) return; // Never rewrite original evidence.
            await this.db.create(SOURCE, { key, scope, userId: source.userId, timestamp: source.timestamp, source });
            const old = await this.db.get(SOURCE, { scope }, { sort: { timestamp: "desc", key: "desc" }, offset: 200, limit: 2000 });
            if (old.length) await this.db.remove(SOURCE, { key: { $in: old.map(r => r.key) } });
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
            let a = state.accounts[digest(userId)];
            if (a && a.personId !== p.id) { invalidate(state, state.people[a.personId]); invalidate(state, p); }
            else if (!a) invalidate(state, p);
            if (!a) a = state.accounts[digest(userId)] = { userId, name: userId, personId: p.id, confidence, revision: 0 };
            a.personId = p.id; a.confidence = confidence; a.revision++; p.provisional = false;
            return a;
        });
    }
    async split(scope: string, userId: string, name: string, actor: string) {
        return this.edit(scope, actor, "split", state => {
            const a = account(state, userId), old = state.people[a.personId];
            invalidate(state, old);
            const p = createPerson(name); p.provisional = false;
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
    async propose(scope: string, userId: string, profile: string, messageIds: string[], actor: string, expected?: { personId: string; personRevision: number; accountRevision: number }, active = () => true) {
        profile = text(profile, 2000, "画像");
        if (!Array.isArray(messageIds) || messageIds.length < 1 || messageIds.length > 10 || messageIds.some(id => typeof id !== "string")) throw new Error("需提供 1 到 10 个消息来源 ID");
        const rows = await this.db.get(SOURCE, { scope, userId, key: { $in: [...new Set(messageIds)].map(id => digest(JSON.stringify([scope, id]))) } });
        if (rows.length !== new Set(messageIds).size) throw new Error("消息来源不属于当前场景和账号，或已超出保留范围");
        return this.edit(scope, actor, "proposal", state => {
            if (!active()) throw new Error("任务已取消");
            if (state.settings.paused || state.settings.mode === "off") throw new Error("维护已暂停或关闭");
            const a = account(state, userId), p = state.people[a.personId];
            if (p.locked) throw new Error("画像已被管理员锁定");
            if (expected && (p.id !== expected.personId || p.revision !== expected.personRevision || a.revision !== expected.accountRevision)) throw new Error("总结期间发生人工修改或身份变更，候选已过期");
            if (Object.keys(state.proposals).length >= 50) throw new Error("待审核候选已达 50 个，请先处理");
            const combined = [...rows.map(r => r.source), ...(p.stale ? [] : p.evidence)];
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
            if (!proposal) throw new Error("当前场景没有此候选");
            if (approve) this.accept(state, proposal);
            delete state.proposals[id];
            return proposal;
        });
    }
    async history(scope: string, limit = 10) {
        return this.db.get(AUDIT, { scope }, { sort: { revision: "desc" }, limit: Math.min(20, Math.max(1, limit)) });
    }
    async audit(scope: string, id: string) { return (await this.db.get(AUDIT, { scope, id }))[0]; }
    async revert(scope: string, id: string, actor: string) {
        const record = (await this.db.get(AUDIT, { scope, id }))[0];
        if (!record) throw new Error("当前场景没有此历史记录");
        return this.edit(scope, actor, `revert:${id}`, state => {
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
            return record;
        });
    }
}
