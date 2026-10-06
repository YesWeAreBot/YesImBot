import { Context, Schema, h, type Session } from "koishi";
import { PersonStore, registerModels, sceneKey, type Mode, type Person, type Proposal, type LinkProposal, type SceneInput, type Audit } from "./store";
import { renderPeople, identityWarning } from "./context";
import { SummaryWorker, type SummaryModel } from "./worker";

declare module "koishi" {
    interface Events {
        "yesimbot/before-user-stimulus": (session: Session) => void | Promise<void>;
    }
}

export const name = "yesimbot-person-memory";
export const inject = { required: ["database", "yesimbot.prompt", "yesimbot.tool", "yesimbot.world-state"], optional: ["yesimbot.model"] };
export interface Config { enabled: boolean; mode: Mode; modelGroup: string; summaryThreshold: number; cooldownSeconds: number; timeoutSeconds: number; maxQueue: number }
export const Config: Schema<Config> = Schema.object({
    enabled: Schema.boolean().default(true).description("启用当前场景的人物记忆与账号关联"),
    mode: Schema.union([Schema.const("off"), Schema.const("review"), Schema.const("auto")]).default("review").description("默认画像维护模式：关闭、人工审核或自动接受；每个场景可用命令覆盖"),
    modelGroup: Schema.string().default("").description("后台总结使用的 YIB 模型组；留空不调用后台模型，仍可人工编辑和审核模型工具提交的候选"),
    summaryThreshold: Schema.number().min(2).max(100).step(1).default(6).description("同一账号累计多少条新消息后尝试总结"),
    cooldownSeconds: Schema.number().min(30).max(86400).default(600).description("同一场景账号两次自动总结至少间隔的秒数"),
    timeoutSeconds: Schema.number().min(5).max(120).default(30).description("一次后台总结超时秒数"),
    maxQueue: Schema.number().min(1).max(100).step(1).default(32).description("待总结任务上限；全局同时运行一个任务"),
});
interface Tools { capabilities?: { trustedToolSession?: number }; registerTool(tool: unknown): void | (() => void); unregisterTool(name: string): void }
interface Prompt { inject(name: string, priority: number, fn: (scope: Record<string, any>) => Promise<string>): void | (() => void) }
interface Models { useChatGroup(name: string): { chat(options: any): Promise<{ text?: string }> } | undefined }
interface Dependencies { "yesimbot.tool": Tools; "yesimbot.prompt": Prompt; "yesimbot.world-state": { capabilities?: { beforeUserStimulus?: number }; isChannelAllowed(session: Session): boolean }; "yesimbot.model"?: Models }
const Success = (result: unknown) => ({ status: "success", result });
const Failed = (error: unknown) => ({ status: "error", error: { name: "PersonMemoryError", message: error instanceof Error ? error.message : String(error) } });
const key = (session: Session) => sceneKey(session as unknown as SceneInput);
function profileView(p: Person) {
    return { id: p.id, name: p.name, provisional: p.provisional, profile: p.stale ? "" : p.profile, stale: p.stale, locked: p.locked, revision: p.revision,
        identityChanged: !!p.identityChanged, identityChangedAt: p.identityChangedAt, warning: p.identityChanged ? identityWarning : undefined,
        evidence: p.evidence.map(e => ({ messageId: e.id, userId: e.userId, name: e.name, timestamp: e.timestamp })) };
}
function show(p: Person) {
    return `${p.name} (${p.id})\n画像版本 ${p.revision}；${p.provisional ? "独立临时档案" : "人工确认称呼"}；${p.locked ? "已锁定" : "未锁定"}；${p.stale ? "旧画像需复核" : "画像可用"}${p.identityChanged ? `\n${identityWarning}` : ""}\n${p.profile || "暂无画像"}\n来源：${p.evidence.map(e => `${e.id}@${e.userId}`).join("，") || "人工编辑或暂无来源"}`;
}
function historyView(rows: Audit[], personId: string, userId?: string) {
    // Model reads are bounded and omit raw evidence bodies; admins can inspect full audits.
    const summarize = (value: unknown) => {
        if (!value || typeof value !== "object") return null;
        const fields = ["profile", "name", "userId", "personId", "sourcePersonId", "targetPersonId", "revision", "confidence", "locked", "stale", "identityChanged", "identityChangedAt"];
        return JSON.stringify(Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, (value as any)[key]]))).slice(0, 120);
    };
    const personIds = new Set([personId]);
    const result = rows.slice(0, 10).map(row => {
        for (const change of row.changes) if (change.collection === "accounts") {
            for (const value of [change.before, change.after] as any[]) if (value?.userId === userId && value.personId) personIds.add(value.personId);
        }
        const related = row.changes.filter(change => {
            if (change.collection === "people") return personIds.has(change.key);
            return [change.before, change.after].some((value: any) => value && ((userId && value.userId === userId) || (!userId && personIds.has(value.personId)) || personIds.has(value.sourcePersonId) || personIds.has(value.targetPersonId)));
        });
        return { id: row.id, revision: row.revision, timestamp: row.timestamp, actor: row.actor.slice(0, 80), action: row.action.slice(0, 80), changeCount: related.length,
            truncated: related.length > 3, changes: related.slice(0, 3).map(change => ({ collection: change.collection, key: change.key.slice(0, 80), before: summarize(change.before), after: summarize(change.after) })) };
    });
    while (JSON.stringify(result).length > 12000) {
        const row = [...result].reverse().find(value => value.changes.length);
        if (!row) break;
        row.changes.pop(); row.truncated = true;
    }
    return result;
}
function candidate(p: Proposal | LinkProposal) {
    const detail = "targetPersonId" in p
        ? `类型：账号关联\n账号 ${p.userId}；来源人物 ${p.sourcePersonId}，画像版本 ${p.sourcePersonRevision}，关联版本 ${p.accountRevision}\n目标人物 ${p.targetPersonId}，画像版本 ${p.targetPersonRevision}；确信度 ${p.confidence}\n依据：${p.reason}`
        : `类型：画像\n账号 ${p.userId} → 人物 ${p.personId}；画像版本 ${p.personRevision}，关联版本 ${p.accountRevision}\n候选：${p.profile}`;
    return `${p.id}\n${detail}\n证据：\n${p.evidence.map(e => `${e.id} / ${e.userId} / ${e.name} / ${new Date(e.timestamp).toISOString()}\n${e.text}`).join("\n")}`;
}

export function apply(ctx: Context, config: Config) {
    if (!config.enabled) return;
    const deps = ctx as unknown as Dependencies;
    if (deps["yesimbot.world-state"].capabilities?.beforeUserStimulus !== 1 || deps["yesimbot.tool"].capabilities?.trustedToolSession !== 1) {
        throw new Error("人物记忆需要 YesImBot 3.0.4 或包含 beforeUserStimulus v1 与 trustedToolSession v1 能力的源码核心，请升级核心后重新启用插件");
    }
    registerModels(ctx);
    const logger = ctx.logger(name), store = new PersonStore(ctx.database, config.mode);
    let active = true;
    const allowed = (session: Session) => active && ctx.filter(session) && deps["yesimbot.world-state"].isChannelAllowed(session);
    let model: SummaryModel | undefined;
    if (config.modelGroup) model = async (messages, signal) => {
        const group = deps["yesimbot.model"]?.useChatGroup(config.modelGroup);
        if (!group) throw new Error("总结模型组不存在或模型服务不可用");
        const result = await group.chat({ messages, abortSignal: signal, singleStep: true, stream: false, temperature: 0.2, maxTokens: 1800 });
        return result.text || "";
    };
    const worker = new SummaryWorker(store, model, { threshold: config.summaryThreshold, cooldownMs: config.cooldownSeconds * 1000, timeoutMs: config.timeoutSeconds * 1000, maxQueue: config.maxQueue }, error => logger.warn(`后台人物总结未接受：${String(error)}`));
    const removeInjection = deps["yesimbot.prompt"].inject("person_memory", 35, view => view.session && allowed(view.session) ? renderPeople(store, view) : Promise.resolve(""));

    ctx.on("yesimbot/before-user-stimulus", async (session: Session) => {
        if (!allowed(session) || !session.userId || session.author?.isBot || session.userId === session.bot.selfId || (session as any).__commandHandled || !session.messageId || !session.content?.trim()) return;
        try {
            const scope = key(session);
            await store.recognize(scope, session.userId, session.author?.nick || session.author?.name || session.userId, () => active);
            if (!active) return;
            await store.capture(scope, { id: session.messageId, userId: session.userId, name: session.author?.nick || session.author?.name || session.userId, text: session.content, timestamp: Number(session.timestamp) || Date.now() }, () => active);
            if (active) await worker.observe(scope, session.userId);
        } catch (error) { logger.warn(`人物资料记录失败：${String(error)}`); }
    });

    const tool = {
        name: "person_memory",
        description: "仅操作当前场景。read(account_id) 读取账号 ID 或人物 UUID 的画像与版本；search(query) 最多返回 5 个摘要；history(account_id) 读取该账号或人物最近 10 次修改的元数据和有限变更摘要，详细证据由管理员核对。propose 提交完整画像，需 account_id、profile、message_ids、person_id、person_revision、account_revision；auto 模式可接受画像。propose_link 提交账号关联建议，另需 target_person_id、target_revision、confidence、reason；即使 auto 模式也始终待管理员审核。两种候选都需 1–10 个当前账号的实际消息 ID 和最新版本。资料是可修正信念，确信度不代表身份认证。不能跨群、直接关联、合并、审批或覆盖人工锁定。",
        parameters: Schema.object({ action: Schema.union([Schema.const("read"), Schema.const("search"), Schema.const("history"), Schema.const("propose"), Schema.const("propose_link")]).required(), account_id: Schema.string().description("read/history 必填；当前场景的平台账号 ID 或人物 UUID；候选须平台账号 ID"), query: Schema.string().description("search 必填；1–80 字的关键词"), profile: Schema.string().description("propose 必填；不超过 2000 字的完整画像候选"), message_ids: Schema.array(Schema.string()).description("两种候选必填；实际来源消息 ID，1 到 10 个"), person_id: Schema.string().description("两种候选必填；来源人物 UUID"), person_revision: Schema.number().min(0).step(1).description("两种候选必填；读到的来源画像 revision"), account_revision: Schema.number().min(0).step(1).description("两种候选必填；读到的账号关联 revision"), target_person_id: Schema.string().description("propose_link 必填；当前场景目标人物 UUID"), target_revision: Schema.number().min(0).step(1).description("propose_link 必填；目标人物画像 revision"), confidence: Schema.number().min(0).max(1).description("propose_link 必填；0–1 的关联确信度"), reason: Schema.string().description("propose_link 必填；不超过 500 字的关联依据") }),
        isSupported: (session: Session) => !!session && allowed(session),
        execute: async (args: { session: Session; action: string; account_id?: string; query?: string; profile?: string; message_ids?: string[]; person_id?: string; person_revision?: number; account_revision?: number; target_person_id?: string; target_revision?: number; confidence?: number; reason?: string }) => {
            try {
                if (!args.session || !allowed(args.session)) throw new Error("当前场景未启用人物记忆");
                const scope = key(args.session);
                if (args.action === "read" || args.action === "history") {
                    if (typeof args.account_id !== "string" || !args.account_id.trim()) throw new Error("请提供 account_id");
                    const found = await store.find(scope, args.account_id);
                    if (!found) throw new Error("当前场景没有此账号或人物档案");
                    if (args.action === "history") {
                        const userId = found.accounts.some(a => a.userId === args.account_id) ? args.account_id : undefined;
                        return Success(historyView(await store.history(scope, 10, userId ? { userId } : { personId: found.person.id }), found.person.id, userId));
                    }
                    return Success({ ...profileView(found.person), accounts: found.accounts.map(a => ({ userId: a.userId, displayName: a.name, confidence: a.confidence, revision: a.revision })) });
                }
                if (args.action === "search") {
                    if (typeof args.query !== "string" || !args.query.trim() || args.query.length > 80) throw new Error("请提供 1 到 80 字的关键词");
                    const q = args.query.toLocaleLowerCase();
                    const state = await store.read(scope);
                    return Success(Object.values(state.people).filter(p => p.name.toLocaleLowerCase().includes(q) || (!p.stale && p.profile.toLocaleLowerCase().includes(q))).slice(0, 5).map(p => ({ id: p.id, name: p.name, profile: p.stale ? "" : p.profile.slice(0, 300), stale: p.stale, revision: p.revision, locked: p.locked, identityChanged: !!p.identityChanged })));
                }
                if (args.action === "propose" || args.action === "propose_link") {
                    if (typeof args.account_id !== "string" || !args.account_id.trim() || !Array.isArray(args.message_ids) || args.message_ids.length < 1 || args.message_ids.length > 10 || args.message_ids.some(id => typeof id !== "string" || !id.trim())) throw new Error("请提供 account_id 和 1–10 个实际 message_ids");
                    if (typeof args.person_id !== "string" || !args.person_id.trim() || !Number.isSafeInteger(args.person_revision) || !Number.isSafeInteger(args.account_revision) || args.person_revision! < 0 || args.account_revision! < 0) throw new Error("请先 read，并提交 person_id、person_revision、account_revision");
                    if (args.action === "propose_link") {
                        if (typeof args.target_person_id !== "string" || !args.target_person_id.trim() || !Number.isSafeInteger(args.target_revision) || args.target_revision! < 0) throw new Error("请提供当前场景的 target_person_id 和 target_revision");
                        if (typeof args.confidence !== "number" || !Number.isFinite(args.confidence) || args.confidence < 0 || args.confidence > 1 || typeof args.reason !== "string" || !args.reason.trim() || args.reason.length > 500) throw new Error("请提供 0–1 的 confidence 和 1–500 字的 reason");
                        const proposal = await store.proposeLink(scope, args.account_id, args.target_person_id, args.confidence, args.reason, args.message_ids, "main-model", { personId: args.person_id, personRevision: args.person_revision!, accountRevision: args.account_revision!, targetRevision: args.target_revision! }, () => active);
                        return Success({ id: proposal.id, type: "link", sourcePersonId: proposal.sourcePersonId, targetPersonId: proposal.targetPersonId, state: proposal.state });
                    }
                    if (typeof args.profile !== "string" || !args.profile.trim()) throw new Error("请提供 profile");
                    const proposal = await store.propose(scope, args.account_id, args.profile, args.message_ids, "main-model", { personId: args.person_id, personRevision: args.person_revision!, accountRevision: args.account_revision! }, () => active);
                    return Success({ id: proposal.id, type: "profile", personId: proposal.personId, state: proposal.state });
                }
                throw new Error("模型仅可 read、search、history、propose 或 propose_link");
            } catch (error) { return Failed(error); }
        },
    };
    const removeTool = deps["yesimbot.tool"].registerTool(tool);
    ctx.on("dispose", () => { active = false; worker.stop(); if (typeof removeTool === "function") removeTool(); else deps["yesimbot.tool"].unregisterTool(tool.name); if (typeof removeInjection === "function") removeInjection(); });

    function command(declaration: string, description: string, action: (scope: string, actor: string, args: any[], session: Session, options: Record<string, any>) => Promise<string>) {
        return ctx.command(declaration, description, { authority: 3 }).action(async ({ session, options }, ...args) => {
            try {
                if (!session || !allowed(session)) throw new Error("当前场景未启用人物记忆");
                const authority = (session.user as { authority?: number } | undefined)?.authority ?? (await session.observeUser<"authority">(["authority"])).authority;
                if (authority < 3) throw new Error("仅管理员可以管理人物记忆（authority ≥ 3）");
                const result = await action(key(session), `admin:${session.platform}:${session.userId}`, args, session, options || {});
                if (result.length <= 1800) return h.escape(result);
                for (let start = 0; start < Math.min(result.length, 36000); start += 1800) await session.send(h.escape(result.slice(start, start + 1800)));
                return result.length > 36000 ? "输出已截断，请缩小查询范围。" : "";
            } catch (error) { return `人物记忆：${error instanceof Error ? error.message : String(error)}`; }
        });
    }
    ctx.command("people", "人物记忆管理：查看、认人、记人、审核与回滚，限当前场景", { authority: 3 });
    command("people.status", "查看维护模式、总结队列、最近结果或失败", async (scope) => {
        const state = await store.read(scope);
        const profilePending = Object.keys(state.proposals).length, linkPending = Object.keys(state.linkProposals).length;
        return JSON.stringify({ mode: state.settings.mode, paused: state.settings.paused, accounts: Object.keys(state.accounts).length, people: Object.keys(state.people).length, pending: profilePending + linkPending, profilePending, linkPending, modelGroup: config.modelGroup || "未配置", ...worker.status(scope) }, null, 2);
    });
    command("people.list [offset:natural]", "分页查看当前场景的人物，每页 20 人", async (scope, _actor, [offset = 0]) => {
        const state = await store.read(scope), all = Object.values(state.people);
        return `人物 ${all.length} 个；模式 ${state.settings.mode}；${state.settings.paused ? "已暂停" : "维护中"}\n${all.slice(offset, offset + 20).map(p => `${p.id} ${p.name}${p.locked ? " [锁定]" : ""}${p.stale ? " [需复核]" : ""}`).join("\n")}`;
    });
    command("people.create <name:text>", "创建独立人物档案，返回 UUID", async (scope, actor, [name]) => { const p = await store.create(scope, name, actor); return `已创建 ${p.name} (${p.id})`; });
    command("people.show <ref:string>", "按账号 ID 或人物 UUID 查看画像及关联", async (scope, _actor, [ref]) => { const found = await store.find(scope, ref); if (!found) throw new Error("当前场景查无此人"); return `${show(found.person)}\n账号：\n${found.accounts.map(a => `${a.userId} / ${a.name} → ${a.confidence}；关联版本 ${a.revision}`).join("\n")}`; });
    command("people.rename <ref:string> <name:text>", "修改心中称呼（不改平台昵称）", async (scope, actor, [ref, name]) => `已改称呼：${(await store.rename(scope, ref, name, actor)).name}`);
    command("people.edit <ref:string> <profile:text>", "人工替换完整画像，可直接纠错并清除需复核标记", async (scope, actor, [ref, profile]) => `已更新：${show(await store.setProfile(scope, ref, profile, actor))}`);
    command("people.clear <ref:string>", "清空当前画像，历史与来源仍保留", async (scope, actor, [ref]) => `已清空：${(await store.setProfile(scope, ref, "", actor)).name}`);
    command("people.archive <ref:string> [revision:natural]", "预览归档人物；指定当前画像版本后移除档案与关联，保留历史和来源", async (scope, actor, [ref, revision]) => {
        const found = await store.find(scope, ref);
        if (!found) throw new Error("当前场景查无此人");
        if (revision === undefined) return `归档预览：${found.person.name} (${found.person.id})\n当前画像版本 ${found.person.revision}\n关联账号：${found.accounts.map(a => `${a.userId} / ${a.name}`).join("，") || "无"}\n执行 people.archive ${found.person.id} ${found.person.revision} 将移除此人物、关联账号与相关候选；历史和来源保留。`;
        if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("请提供预览中的有效画像版本");
        const archived = await store.archive(scope, ref, actor, revision);
        return `已归档 ${archived.name} (${archived.id})；历史和来源保留`;
    });
    command("people.bind <account:string> <target:string> [confidence:number]", "将账号关联到已有的人物 UUID 或账号对应人物", async (scope, actor, [id, target, confidence = 1]) => { const a = await store.bind(scope, id, target, confidence, actor); return `已关联 ${a.userId} → ${a.personId} (${a.confidence})；受影响的旧画像已标记需复核`; });
    command("people.unbind <account:string>", "解除旧关联，为账号建立临时独立档案", async (scope, actor, [id]) => { const p = await store.unbind(scope, id, actor); return `已解除关联，独立档案 ${p.id}；旧画像需复核`; });
    command("people.split <account:string> <name:text>", "从共用人物中拆出账号并创建独立档案", async (scope, actor, [id, name]) => { const p = await store.split(scope, id, name, actor); return `已拆分 ${id} → ${p.name} (${p.id})；旧画像需复核`; });
    command("people.merge <from:string> <into:string>", "合并两个当前场景人物，画像保留来源并标为需复核", async (scope, actor, [from, into]) => { const p = await store.merge(scope, from, into, actor); return `已合并到 ${p.name} (${p.id})；请复核画像`; });
    for (const locked of [true, false]) command(`people.${locked ? "lock" : "unlock"} <ref:string>`, locked ? "锁定画像，禁止模型更新" : "允许模型提出新的画像候选", async (scope, actor, [ref]) => { const p = await store.lock(scope, ref, locked, actor); return `${p.name} 已${locked ? "锁定" : "解锁"}`; });
    command("people.sources <account:string>", "查看当前账号最近 10 条原始消息证据快照", async (scope, _actor, [id]) => { const rows = await store.sources(scope, id, 10); return rows.map(e => `${e.id} / ${e.userId} / ${e.name} / ${new Date(e.timestamp).toISOString()}\n${e.text}`).join("\n") || "暂无来源快照"; });
    command("people.pending [id:string]", "查看待审候选，指定 UUID 查看完整内容及来源", async (scope, _actor, [id]) => {
        const state = await store.read(scope);
        if (id) { const p = Object.hasOwn(state.proposals, id) ? state.proposals[id] : Object.hasOwn(state.linkProposals, id) ? state.linkProposals[id] : undefined; if (!p) throw new Error("当前场景没有此候选"); return candidate(p); }
        return [...Object.values(state.proposals).map(p => `${p.id} / 画像 / ${p.userId} / ${p.profile.slice(0, 60)}`), ...Object.values(state.linkProposals).map(p => `${p.id} / 账号关联 / ${p.userId} → ${p.targetPersonId} / ${p.reason.slice(0, 60)}`)].join("\n") || "暂无待审核候选";
    });
    for (const approve of [true, false]) command(`people.${approve ? "approve" : "reject"} <id:string>`, approve ? "审核接受候选，版本变化或锁定时拒绝" : "拒绝并移除候选", async (scope, actor, [id]) => { await store.review(scope, id, approve, actor); return `已${approve ? "接受" : "拒绝"}候选 ${id}`; });
    command("people.history [id:string]", "分页查看修改；可按账号、人物 UUID 或动作筛选，指定记录 UUID 查看完整差异", async (scope, _actor, [id], _session, options) => {
        if (id) { const row = await store.audit(scope, id); if (!row) throw new Error("当前场景没有此历史记录"); return JSON.stringify(row, null, 2); }
        const page = options.page ?? 1;
        if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger((page - 1) * 10)) throw new Error("页码必须是从 1 开始的整数");
        if (options.account && options.person) throw new Error("不能同时使用 --account 和 --person，请选择一种筛选");
        const rows = await store.history(scope, 10, { offset: (page - 1) * 10, userId: options.account, personId: options.person, action: options.action });
        return `第 ${page} 页；每页 10 条\n${rows.map(row => `${row.id} / #${row.revision} ${row.action} / ${row.actor}`).join("\n") || "暂无修改历史"}`;
    }).option("page", "--page <page:natural>", { fallback: 1 }).option("account", "--account <account:string>").option("person", "--person <person:string>").option("action", "--action <action:string>");
    command("people.revert <id:string>", "条件回滚一次修改，存在后续冲突则拒绝", async (scope, actor, [id]) => { await store.revert(scope, id, actor); return `已回滚 ${id}；画像/关联版本继续递增`; });
    for (const paused of [true, false]) command(`people.${paused ? "pause" : "resume"}`, paused ? "暂停当前场景模型维护，仍可查询和人工修改" : "恢复当前场景模型维护", async (scope, actor) => { await store.settings(scope, { paused }, actor); if (paused) worker.cancel(scope); return `当前场景已${paused ? "暂停" : "恢复"}维护`; });
    command("people.mode <mode:string>", "设置当前场景 off/review/auto，不自动接受既有候选", async (scope, actor, [mode]) => { await store.settings(scope, { mode }, actor); worker.cancel(scope); return `当前场景维护模式：${mode}`; });
    command("people.summarize <account:string>", "手动触发当前账号总结，仍遵循审核模式与锁定", async (scope, _actor, [id]) => `总结结果：${await worker.summarize(scope, id)}；用 people.pending 查看候选`);
}
