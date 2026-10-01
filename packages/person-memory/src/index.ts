import { Context, Schema, h, type Session } from "koishi";
import { PersonStore, registerModels, sceneKey, type Mode, type Person, type Proposal, type SceneInput } from "./store";
import { renderPeople } from "./context";
import { SummaryWorker, type SummaryModel } from "./worker";

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
interface Tools { registerTool(tool: unknown): void; unregisterTool(name: string): void }
interface Prompt { inject(name: string, priority: number, fn: (scope: Record<string, any>) => Promise<string>): void | (() => void) }
interface Models { useChatGroup(name: string): { chat(options: any): Promise<{ text?: string }> } | undefined }
interface Dependencies { "yesimbot.tool": Tools; "yesimbot.prompt": Prompt; "yesimbot.world-state": { isChannelAllowed(session: Session): boolean }; "yesimbot.model"?: Models }
const Success = (result: unknown) => ({ status: "success", result });
const Failed = (error: unknown) => ({ status: "error", error: { name: "PersonMemoryError", message: error instanceof Error ? error.message : String(error) } });
const key = (session: Session) => sceneKey(session as unknown as SceneInput);
function profileView(p: Person) {
    return { id: p.id, name: p.name, provisional: p.provisional, profile: p.stale ? "" : p.profile, stale: p.stale, locked: p.locked, revision: p.revision,
        evidence: p.evidence.map(e => ({ messageId: e.id, userId: e.userId, name: e.name, timestamp: e.timestamp })) };
}
function show(p: Person) {
    return `${p.name} (${p.id})\n画像版本 ${p.revision}；${p.provisional ? "独立临时档案" : "人工确认称呼"}；${p.locked ? "已锁定" : "未锁定"}；${p.stale ? "旧画像需复核" : "画像可用"}\n${p.profile || "暂无画像"}\n来源：${p.evidence.map(e => `${e.id}@${e.userId}`).join("，") || "人工编辑或暂无来源"}`;
}
function candidate(p: Proposal) { return `${p.id}\n账号 ${p.userId} → 人物 ${p.personId}；画像版本 ${p.personRevision}，关联版本 ${p.accountRevision}\n候选：${p.profile}\n证据：\n${p.evidence.map(e => `${e.id} / ${e.userId} / ${e.name} / ${new Date(e.timestamp).toISOString()}\n${e.text}`).join("\n")}`; }

export function apply(ctx: Context, config: Config) {
    if (!config.enabled) return;
    registerModels(ctx);
    const deps = ctx as unknown as Dependencies;
    const logger = ctx.logger(name), store = new PersonStore(ctx.database, config.mode);
    let active = true;
    const allowed = (session: Session) => active && deps["yesimbot.world-state"].isChannelAllowed(session);
    let model: SummaryModel | undefined;
    if (config.modelGroup) model = async (messages, signal) => {
        const group = deps["yesimbot.model"]?.useChatGroup(config.modelGroup);
        if (!group) throw new Error("总结模型组不存在或模型服务不可用");
        const result = await group.chat({ messages, abortSignal: signal, singleStep: true, stream: false, temperature: 0.2, maxTokens: 1800 });
        return result.text || "";
    };
    const worker = new SummaryWorker(store, model, { threshold: config.summaryThreshold, cooldownMs: config.cooldownSeconds * 1000, timeoutMs: config.timeoutSeconds * 1000, maxQueue: config.maxQueue }, error => logger.warn(`后台人物总结未接受：${String(error)}`));
    const removeInjection = deps["yesimbot.prompt"].inject("person_memory", 35, view => view.session && allowed(view.session) ? renderPeople(store, view) : Promise.resolve(""));

    ctx.middleware(async (session, next) => {
        const result = await next();
        if (!allowed(session) || !session.userId || session.author?.isBot || session.userId === session.bot.selfId || (session as any).__commandHandled || !session.messageId || !session.content?.trim()) return result;
        try {
            const scope = key(session);
            await store.recognize(scope, session.userId, session.author?.nick || session.author?.name || session.userId);
            if (!active) return result;
            await store.capture(scope, { id: session.messageId, userId: session.userId, name: session.author?.nick || session.author?.name || session.userId, text: session.content, timestamp: Number(session.timestamp) || Date.now() });
            await worker.observe(scope, session.userId);
        } catch (error) { logger.warn(`人物资料记录失败：${String(error)}`); }
        return result;
    });

    const tool = {
        name: "person_memory",
        description: "读取当前场景的账号关联/人物画像或提交有消息证据的完整画像候选。read 需 account_id，search 按称呼或画像关键词返回最多 5 个摘要。propose 需 account_id、profile、1–10 个实际消息 ID，以及从上下文或 read 取得的 person_id、person_revision、account_revision；过期版本会拒绝。画像是可修正信念，确信度不代表身份认证。不能跨群、合并账号、审批或覆盖人工锁定；默认候选需管理员审核，auto 模式才能自动接受。",
        parameters: Schema.object({ action: Schema.union([Schema.const("read"), Schema.const("search"), Schema.const("propose")]).required(), account_id: Schema.string().description("当前场景的平台账号 ID"), query: Schema.string().description("搜索关键词"), profile: Schema.string().description("不超过 2000 字的完整画像候选"), message_ids: Schema.array(Schema.string()).description("实际来源消息 ID，1 到 10 个"), person_id: Schema.string().description("候选针对的人物 UUID"), person_revision: Schema.number().min(0).step(1).description("读到的画像 revision"), account_revision: Schema.number().min(0).step(1).description("读到的账号关联 revision") }),
        isSupported: (session: Session) => !!session && allowed(session),
        execute: async (args: { session: Session; action: string; account_id?: string; query?: string; profile?: string; message_ids?: string[]; person_id?: string; person_revision?: number; account_revision?: number }) => {
            try {
                if (!args.session || !allowed(args.session)) throw new Error("当前场景未启用人物记忆");
                const scope = key(args.session);
                if (args.action === "read") {
                    if (!args.account_id) throw new Error("请提供 account_id");
                    const found = await store.find(scope, args.account_id);
                    if (!found) throw new Error("当前场景没有此账号或人物档案");
                    return Success({ ...profileView(found.person), accounts: found.accounts.map(a => ({ userId: a.userId, displayName: a.name, confidence: a.confidence, revision: a.revision })) });
                }
                if (args.action === "search") {
                    if (typeof args.query !== "string" || !args.query.trim() || args.query.length > 80) throw new Error("请提供 1 到 80 字的关键词");
                    const q = args.query.toLocaleLowerCase();
                    const state = await store.read(scope);
                    return Success(Object.values(state.people).filter(p => p.name.toLocaleLowerCase().includes(q) || (!p.stale && p.profile.toLocaleLowerCase().includes(q))).slice(0, 5).map(p => ({ id: p.id, name: p.name, profile: p.stale ? "" : p.profile.slice(0, 300), stale: p.stale })));
                }
                if (args.action === "propose") {
                    if (!args.account_id || !args.profile || !args.message_ids) throw new Error("请提供 account_id、profile、message_ids");
                    if (!args.person_id || !Number.isInteger(args.person_revision) || !Number.isInteger(args.account_revision) || args.person_revision! < 0 || args.account_revision! < 0) throw new Error("请先 read，并提交 person_id、person_revision、account_revision");
                    const proposal = await store.propose(scope, args.account_id, args.profile, args.message_ids, "main-model", { personId: args.person_id, personRevision: args.person_revision!, accountRevision: args.account_revision! }, () => active);
                    return Success({ id: proposal.id, personId: proposal.personId, state: proposal.state });
                }
                throw new Error("模型仅可 read、search 或 propose");
            } catch (error) { return Failed(error); }
        },
    };
    deps["yesimbot.tool"].registerTool(tool);
    ctx.on("dispose", () => { active = false; worker.stop(); deps["yesimbot.tool"].unregisterTool(tool.name); if (typeof removeInjection === "function") removeInjection(); });

    function command(declaration: string, description: string, action: (scope: string, actor: string, args: any[], session: Session) => Promise<string>) {
        return ctx.command(declaration, description, { authority: 3 }).action(async ({ session }, ...args) => {
            try {
                if (!session || !allowed(session)) throw new Error("当前场景未启用人物记忆");
                const authority = (session.user as { authority?: number } | undefined)?.authority ?? (await session.observeUser<"authority">(["authority"])).authority;
                if (authority < 3) throw new Error("仅管理员可以管理人物记忆（authority ≥ 3）");
                const result = await action(key(session), `admin:${session.platform}:${session.userId}`, args, session);
                if (result.length <= 1800) return h.escape(result);
                for (let start = 0; start < Math.min(result.length, 36000); start += 1800) await session.send(h.escape(result.slice(start, start + 1800)));
                return result.length > 36000 ? "输出已截断，请缩小查询范围。" : "";
            } catch (error) { return `人物记忆：${error instanceof Error ? error.message : String(error)}`; }
        });
    }
    ctx.command("people", "人物记忆管理：查看、认人、记人、审核与回滚，限当前场景", { authority: 3 });
    command("people.status", "查看维护模式、总结队列、最近结果或失败", async (scope) => {
        const state = await store.read(scope);
        return JSON.stringify({ mode: state.settings.mode, paused: state.settings.paused, accounts: Object.keys(state.accounts).length, people: Object.keys(state.people).length, pending: Object.keys(state.proposals).length, modelGroup: config.modelGroup || "未配置", ...worker.status(scope) }, null, 2);
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
    command("people.bind <account:string> <target:string> [confidence:number]", "将账号关联到已有的人物 UUID 或账号对应人物", async (scope, actor, [id, target, confidence = 1]) => { const a = await store.bind(scope, id, target, confidence, actor); return `已关联 ${a.userId} → ${a.personId} (${a.confidence})；受影响的旧画像已标记需复核`; });
    command("people.unbind <account:string>", "解除旧关联，为账号建立临时独立档案", async (scope, actor, [id]) => { const p = await store.unbind(scope, id, actor); return `已解除关联，独立档案 ${p.id}；旧画像需复核`; });
    command("people.split <account:string> <name:text>", "从共用人物中拆出账号并创建独立档案", async (scope, actor, [id, name]) => { const p = await store.split(scope, id, name, actor); return `已拆分 ${id} → ${p.name} (${p.id})；旧画像需复核`; });
    command("people.merge <from:string> <into:string>", "合并两个当前场景人物，画像保留来源并标为需复核", async (scope, actor, [from, into]) => { const p = await store.merge(scope, from, into, actor); return `已合并到 ${p.name} (${p.id})；请复核画像`; });
    for (const locked of [true, false]) command(`people.${locked ? "lock" : "unlock"} <ref:string>`, locked ? "锁定画像，禁止模型更新" : "允许模型提出新的画像候选", async (scope, actor, [ref]) => { const p = await store.lock(scope, ref, locked, actor); return `${p.name} 已${locked ? "锁定" : "解锁"}`; });
    command("people.sources <account:string>", "查看当前账号最近 10 条原始消息证据快照", async (scope, _actor, [id]) => { const rows = await store.sources(scope, id, 10); return rows.map(e => `${e.id} / ${e.userId} / ${e.name} / ${new Date(e.timestamp).toISOString()}\n${e.text}`).join("\n") || "暂无来源快照"; });
    command("people.pending [id:string]", "查看待审候选，指定 UUID 查看完整内容及来源", async (scope, _actor, [id]) => {
        const state = await store.read(scope);
        if (id) { const p = Object.hasOwn(state.proposals, id) && state.proposals[id]; if (!p) throw new Error("当前场景没有此候选"); return candidate(p); }
        return Object.values(state.proposals).map(p => `${p.id} / ${p.userId} / ${p.profile.slice(0, 60)}`).join("\n") || "暂无待审核候选";
    });
    for (const approve of [true, false]) command(`people.${approve ? "approve" : "reject"} <id:string>`, approve ? "审核接受候选，版本变化或锁定时拒绝" : "拒绝并移除候选", async (scope, actor, [id]) => { await store.review(scope, id, approve, actor); return `已${approve ? "接受" : "拒绝"}候选 ${id}`; });
    command("people.history [id:string]", "查看最近 10 次修改；指定 UUID 查看完整前后差异", async (scope, _actor, [id]) => {
        if (id) { const row = await store.audit(scope, id); if (!row) throw new Error("当前场景没有此历史记录"); return JSON.stringify(row, null, 2); }
        const rows = await store.history(scope, 10);
        return rows.slice(0, 10).map(row => `${row.id} / #${row.revision} ${row.action} / ${row.actor}`).join("\n") || "暂无修改历史";
    });
    command("people.revert <id:string>", "条件回滚一次修改，存在后续冲突则拒绝", async (scope, actor, [id]) => { await store.revert(scope, id, actor); return `已回滚 ${id}；画像/关联版本继续递增`; });
    for (const paused of [true, false]) command(`people.${paused ? "pause" : "resume"}`, paused ? "暂停当前场景模型维护，仍可查询和人工修改" : "恢复当前场景模型维护", async (scope, actor) => { await store.settings(scope, { paused }, actor); if (paused) worker.cancel(scope); return `当前场景已${paused ? "暂停" : "恢复"}维护`; });
    command("people.mode <mode:string>", "设置当前场景 off/review/auto，不自动接受既有候选", async (scope, actor, [mode]) => { await store.settings(scope, { mode }, actor); worker.cancel(scope); return `当前场景维护模式：${mode}`; });
    command("people.summarize <account:string>", "手动触发当前账号总结，仍遵循审核模式与锁定", async (scope, _actor, [id]) => `总结结果：${await worker.summarize(scope, id)}；用 people.pending 查看候选`);
}
