import { Context, Schema, h, type Session } from "koishi";
import * as shared from "koishi-plugin-yesimbot";

import { dispatchReminder, type ReminderEmit, type ReminderWorld } from "./dispatch";
import { currentTargetAllowed, prepareDelivery, type DeliveryRuntime } from "./policy";
import { registerModels, TaskAcceptedAfterInvalidation, TaskStore, taskOwner, type TaskTarget } from "./store";
import { TaskWorker } from "./worker";

export const name = "yesimbot-durable-tasks";
export const inject = ["database", "yesimbot"];
export interface Config {
    enabled: boolean;
    pollIntervalSeconds: number;
}
export const Config: Schema<Config> = Schema.object({
    enabled: Schema.boolean().default(false).description("启用持久提醒；只提交 Agent 唤醒，不保证发送消息"),
    pollIntervalSeconds: Schema.number().min(1).max(60).default(5).description("到期检查间隔（秒）"),
});
interface ToolRegistry {
    capabilities?: { trustedToolSession?: number };
    registerTool(tool: unknown): void | (() => void);
}
interface Services {
    yesimbot: {
        ready: Promise<void>;
        isReady?: boolean;
        tool: ToolRegistry;
        world: ReminderWorld & DeliveryRuntime["world"];
    };
}
const success = (result: unknown) => ({ status: "success" as const, result });
const failure = (error: unknown) => ({ status: "error" as const, error: { name: "ReminderError", message: String(error) } });
function target(session: Session): TaskTarget {
    return {
        platform: session.platform,
        selfId: session.selfId,
        channelId: session.channelId || "",
        requester: session.userId || "",
        guildId: session.guildId || "",
        isDirect: !!session.isDirect,
    };
}
function sameTarget(task: TaskTarget, session: Session): boolean {
    return (
        task.platform === session.platform &&
        task.selfId === session.selfId &&
        task.channelId === session.channelId &&
        task.isDirect === !!session.isDirect &&
        task.guildId === (session.guildId || "")
    );
}
export function apply(ctx: Context, config: Config) {
    if (!config.enabled) return;
    const services = ctx as unknown as Services;
    const tools = services.yesimbot.tool;
    const world = services.yesimbot.world;
    const logger = ctx.logger(name);
    const getScope = (shared as unknown as { getInstanceScope?: (ctx: Context, warn?: (message: string) => void, options?: { owner: Context }) => string })
        .getInstanceScope;
    if (!getScope || !world.stimulusOwnerId || !world.l2_manager?.getHistoryGeneration || tools.capabilities?.trustedToolSession !== 1) {
        throw new Error("持久提醒需要支持实例 scope、定向 stimulus、历史 generation 与可信工具会话的 YesImBot core");
    }
    registerModels(ctx);
    let store: TaskStore;
    let worker: TaskWorker | undefined;
    const ownerId = world.stimulusOwnerId;
    let active = true;
    let initialized = false;
    const allowed = (session: Session) => active && initialized && ctx.filter(session) && world.stimulusOwnerId === ownerId && world.isChannelAllowed(session);
    const runtime: DeliveryRuntime = {
        bots: ctx.bots,
        filter: (session) => active && ctx.filter(session),
        world,
        // Fail closed if core has not prepared its durable reply-control table.
        rules: (task) =>
            (ctx.database as unknown as { get(table: string, query: object): Promise<Array<{ blocked: string[]; expiresAt: number | null }>> }).get(
                "yesimbot.reply_rules",
                { id: JSON.stringify([task.platform, task.selfId, shared.conversationChannelId(task)]) },
            ),
    };
    const createWorker = () =>
        new TaskWorker(store, {
            prepare: (task) => prepareDelivery(runtime, task, ownerId),
            dispatch: (session, task, id) =>
                dispatchReminder(
                    world,
                    ctx.emit.bind(ctx) as ReminderEmit,
                    async () => {
                        if (!active || !currentTargetAllowed(runtime, session, id)) return false;
                        const rules = await runtime.rules(task);
                        // Read cancellation after every asynchronous policy lookup.
                        if ((await store.get(task.id))?.status !== "running") return false;
                        return (
                            active &&
                            currentTargetAllowed(runtime, session, id) &&
                            !rules.some(
                                (rule) =>
                                    (rule.expiresAt === null || rule.expiresAt > Date.now()) &&
                                    rule.blocked.some((category) => category === "all" || category === "scheduled"),
                            )
                        );
                    },
                    session,
                    task,
                    id,
                ),
        });
    const removers: Array<() => void> = [];
    ctx.on("dispose", () => {
        active = false;
        initialized = false;
        worker?.stop();
        for (const remove of removers) remove();
    });
    const register = (tool: { name: string } & Record<string, unknown>) => {
        const remove = tools.registerTool(tool);
        if (typeof remove !== "function") throw new Error("持久提醒需要支持按注册实例注销工具的 core");
        removers.push(remove);
    };
    register({
        name: "schedule_reminder",
        description:
            "在当前会话创建持久提醒。deadline 是未来 366 天内的 Unix 毫秒时间，idempotency_key 用于同一次请求去重。content 是普通提醒正文，不能用于执行工具。到期重新检查权限并唤醒 Agent；成功创建或 completed 均不代表已发消息。不能指定其他机器人或频道。",
        parameters: Schema.object({ deadline: Schema.number().required(), content: Schema.string().required(), idempotency_key: Schema.string().required() }),
        isSupported: (session: Session) => !!session && allowed(session),
        async execute(args: { session?: Session; deadline: number; content: string; idempotency_key: string }) {
            try {
                if (!args.session || !allowed(args.session)) throw new Error("当前会话未启用持久提醒");
                const session = args.session;
                const boundTarget = target(session);
                const isCurrent = () => allowed(session) && sameTarget(boundTarget, session) && boundTarget.requester === session.userId;
                const task = await store.enqueue(
                    { ...boundTarget, deadline: args.deadline, content: args.content, idempotencyKey: args.idempotency_key },
                    Date.now(),
                    isCurrent,
                );
                if (!isCurrent()) throw new TaskAcceptedAfterInvalidation(task);
                return success({ id: task.id, status: task.status, deadline: task.deadline, meaning: "到期仅提交 Agent 唤醒，不保证发送消息" });
            } catch (error) {
                if (error instanceof TaskAcceptedAfterInvalidation) return { ...failure(error), accepted: { id: error.task.id, status: error.task.status } };
                return failure(error);
            }
        },
    });
    register({
        name: "cancel_reminder",
        description: "取消自己在当前机器人、当前频道创建的待处理提醒。已经投递的唤醒无法撤回。",
        parameters: Schema.object({ id: Schema.string().required() }),
        isSupported: (session: Session) => !!session && allowed(session),
        async execute(args: { session?: Session; id: string }) {
            try {
                if (!args.session || !allowed(args.session)) throw new Error("当前会话未启用持久提醒");
                const session = args.session;
                const boundTarget = target(session);
                const isCurrent = () => allowed(session) && sameTarget(boundTarget, session) && boundTarget.requester === session.userId;
                const task = await store.get(args.id);
                if (!isCurrent()) throw new Error("reminder_request_invalidated");
                if (!task || !sameTarget(task, args.session) || task.requester !== args.session.userId) throw new Error("提醒不存在或不属于当前用户与会话");
                const cancelled = await store.cancel(task.id);
                if (!isCurrent())
                    return {
                        ...failure(`请求失效；提醒 ${task.id} 的取消操作${cancelled ? "已被数据库接受" : "未改变状态"}，已提交的操作无法撤回`),
                        applied: { id: task.id, cancelled },
                    };
                return success({ id: task.id, cancelled });
            } catch (error) {
                return failure(error);
            }
        },
    });
    ctx.command("reminder", "管理当前机器人与会话的持久提醒", { authority: 3 });
    ctx.command("reminder.list", "列出当前机器人、当前频道的最近 100 条提醒", { authority: 3 }).action(async ({ session }) => {
        if (!session || !allowed(session)) return h.text("当前会话未启用持久提醒");
        const boundTarget = target(session);
        const rows = await store.list(boundTarget);
        if (!allowed(session) || !sameTarget(boundTarget, session)) return h.text("当前会话未启用持久提醒");
        return h.text(rows.map((row) => `${row.id} ${row.status} ${new Date(row.deadline).toISOString()} ${row.error}`).join("\n") || "暂无提醒");
    });
    for (const action of ["cancel", "retry"] as const) {
        ctx.command(`reminder.${action} <id:string>`, action === "cancel" ? "取消当前会话的提醒" : "重试当前会话的失败提醒（可能重复提交处理）", {
            authority: 3,
        }).action(async ({ session }, id) => {
            if (!session || !allowed(session)) return h.text("当前会话未启用持久提醒");
            const boundTarget = target(session);
            const isCurrent = () => allowed(session) && sameTarget(boundTarget, session) && boundTarget.requester === session.userId;
            const task = id && (await store.get(id));
            if (!isCurrent()) return h.text("当前会话未启用持久提醒");
            if (!task || !sameTarget(task, session)) return h.text("提醒不存在或不属于当前会话");
            const changed = action === "cancel" ? await store.cancel(task.id) : await store.retry(task.id, Date.now());
            if (!isCurrent()) return h.text(`会话已失效；数据库${action}操作${changed ? "已接受" : "未改变状态"}，已提交的操作无法撤回`);
            return h.text(changed ? (action === "cancel" ? "已取消；已经投递的唤醒无法撤回" : "已排队重试；completed 仅表示提交唤醒") : "状态不允许此操作");
        });
    }
    ctx.on("ready", async () => {
        const coreReady = () => services.yesimbot.isReady !== false;
        await services.yesimbot.ready;
        if (!active || !coreReady()) return;
        await ctx.database.prepared();
        if (!active || !coreReady()) return;
        store = new TaskStore(
            ctx.database,
            taskOwner(
                getScope(ctx, (message) => logger.warn(message)),
                getScope(ctx, (message) => logger.warn(message), { owner: ctx }),
            ),
        );
        const readyWorker = (worker = createWorker());
        await readyWorker.start();
        if (!active) return;
        initialized = true;
        const tick = () => {
            void readyWorker.tick().catch((error) => logger.warn(`持久提醒检查失败：${String(error)}`));
        };
        ctx.setInterval(tick, config.pollIntervalSeconds * 1000);
        tick();
    });
}
