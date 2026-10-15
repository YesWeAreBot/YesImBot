import { Context, Schema, h, type Session } from "koishi";

import { DirectoryStore, registerModels, type OneBotClient, type Query } from "./store";

export const name = "yesimbot-onebot-directory";
// Match YesImBot’s public service; the plugin can compile independently.
const YESIMBOT = "yesimbot" as const;
export const inject = ["database", YESIMBOT];
type ToolRegistry = { registerTool(tool: unknown): void | (() => void); unregisterTool(name: string): void };
function tools(ctx: Context): ToolRegistry {
    // Standalone package: Koishi does not know YesImBot's context augmentation here.
    const yesimbotContext = ctx as unknown as { yesimbot: { tool: ToolRegistry } };
    return yesimbotContext.yesimbot.tool;
}
const Success = (result: unknown) => ({ status: "success" as const, result });
const Failed = (message: string) => ({ status: "error" as const, error: { name: "ToolError", message } });

export interface Config {
    enabled: boolean;
    concurrency: number;
    batchSize: number;
}
export const Config: Schema<Config> = Schema.object({
    enabled: Schema.boolean().default(true).description("启用 OneBot 联系人查询与缓存"),
    concurrency: Schema.number().min(1).max(4).default(2).description("跨群同时拉取的上限"),
    batchSize: Schema.number().min(20).max(100).default(100).description("数据库每批写入/读取的条数"),
});

function groupId(session: Session, explicit?: string) {
    return explicit || (!session.isDirect ? session.guildId || session.channelId : undefined);
}
async function authorizeModelQuery(session: Session, kind: Query["kind"], requestedGroup?: string) {
    const currentGroup = !session.isDirect ? session.guildId || session.channelId : undefined;
    if (kind === "members" && currentGroup && requestedGroup === currentGroup) return;
    // A cached directory may have come from another bot. Never use it to cross a scene
    // boundary from a public conversation, even if the requesting user is an admin.
    if (!session.isDirect) throw new Error("群聊中的模型只能查询当前群成员");
    let authority: number | undefined = (session.user as { authority?: number } | undefined)?.authority;
    if (authority === undefined) {
        try {
            authority = (await session.observeUser<"authority">(["authority"])).authority;
        } catch {
            authority = 0;
        }
    }
    if (authority < 3) throw new Error("好友名单和跨群查询只允许管理员私聊");
}

function onebot(session: Session) {
    if (session.platform !== "onebot" || !session.bot?.internal) throw new Error("此功能只适用于 OneBot 会话");
    return session.bot as unknown as OneBotClient;
}

export function apply(ctx: Context, config: Config) {
    if (!config.enabled) return;
    registerModels(ctx);
    const store = new DirectoryStore(ctx, config.concurrency, config.batchSize);
    let active = true;
    const allowed = (session: Session) => active && ctx.filter(session);
    const modelUsage = new Map<string, { since: number; calls: number; entries: number }>();
    const tool = {
        name: "onebot_contacts",
        description:
            "读取 OneBot 好友、群成员或机器人已加入的群缓存。首次查询会完整拉取到数据库，但只返回摘要或至多 20 条；后续仅在管理员要求刷新时更新。mode=count 查看数量，mode=lookup 按 user_id 精确查找，mode=page 分页，mode=search 用 query 模糊匹配 UID/昵称/群名；不能通过模型工具一次返回全量。好友按机器人账号隔离，同平台的群名单按群号共享。群聊只能查询当前群成员；好友、群列表和跨群查询仅限管理员私聊。",
        parameters: Schema.object({
            kind: Schema.union([Schema.const("friends"), Schema.const("members"), Schema.const("groups")])
                .required()
                .description("friends 好友、members 群成员或 groups 机器人已加入的群"),
            mode: Schema.union([Schema.const("count"), Schema.const("lookup"), Schema.const("page"), Schema.const("search")])
                .required()
                .description("count 数量、lookup 精确账号、page 分页、search 模糊搜索"),
            group_id: Schema.string().description("群号；在当前群聊可省略"),
            query: Schema.string().description("search 必填：按 UID、昵称、群名、群名片或备注做字面模糊匹配"),
            user_id: Schema.string().description("lookup 必填：精确的用户账号 ID"),
            offset: Schema.number().description("page 起始位置，从 0 开始"),
            limit: Schema.number().description("page 返回条数，最多 20，默认 10"),
        }),
        isSupported: (session: Session) => !!session && allowed(session) && session.platform === "onebot" && !!session.bot?.internal,
        async execute(args: {
            kind: Query["kind"];
            mode: "count" | "lookup" | "page" | "search";
            group_id?: string;
            query?: string;
            user_id?: string;
            offset?: number;
            limit?: number;
            session?: Session;
        }) {
            try {
                if (!args.session) throw new Error("缺少会话");
                if (!allowed(args.session)) throw new Error("当前场景未启用 OneBot 名单查询");
                if (args.mode === "search" && !args.query?.trim()) throw new Error("search 需要 query");
                if (args.mode === "lookup" && !args.user_id) throw new Error("lookup 需要 user_id");
                if (
                    ["page", "search"].includes(args.mode) &&
                    args.limit !== undefined &&
                    (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 20)
                )
                    throw new Error("模型每次最多读取 20 条");
                const session = args.session;
                const requestedGroup = groupId(session, args.group_id);
                await authorizeModelQuery(session, args.kind, requestedGroup);
                const usageKey = `${session.platform}\0${session.bot.selfId}\0${session.channelId}`;
                const now = Date.now();
                // Limit cumulative observations too: repeated pages otherwise recreate a full-list dump.
                let usage = modelUsage.get(usageKey);
                if (!usage || now - usage.since >= 600_000) {
                    usage = { since: now, calls: 0, entries: 0 };
                    modelUsage.set(usageKey, usage);
                }
                if (modelUsage.size > 1024) {
                    for (const [key, value] of modelUsage) if (now - value.since >= 600_000) modelUsage.delete(key);
                    if (modelUsage.size > 1024) modelUsage.delete(modelUsage.keys().next().value!);
                }
                if (usage.calls >= 40 || (args.mode !== "count" && usage.entries >= 80))
                    throw new Error("本会话的名单读取额度已用完；请缩小查询范围，稍后再试");
                const reserved = args.mode === "count" ? 0 : ["page", "search"].includes(args.mode) ? Math.min(args.limit ?? 10, 20, 80 - usage.entries) : 1;
                usage.calls++;
                usage.entries += reserved; // Reserve before awaiting concurrent tool calls.
                let result;
                try {
                    result = await store.query(onebot(session), {
                        kind: args.kind,
                        groupId: requestedGroup,
                        summaryOnly: args.mode === "count",
                        userId: args.mode === "lookup" ? args.user_id : undefined,
                        query: args.mode === "search" ? args.query : undefined,
                        offset: ["page", "search"].includes(args.mode) ? args.offset : undefined,
                        limit: reserved || 1,
                    });
                } catch (error) {
                    usage.entries -= reserved;
                    throw error;
                }
                usage.entries -= reserved - result.entries.length;
                return Success({
                    kind: result.kind,
                    groupId: result.groupId,
                    total: result.total,
                    fetchedAt: result.fetchedAt,
                    sourceBotId: result.sourceBotId,
                    offset: result.offset,
                    returned: result.returned,
                    hasMore: ["page", "search"].includes(args.mode) && result.offset + result.returned < result.total,
                    entries: result.entries.map((item) => ({
                        ...(args.kind === "groups" ? { groupId: item.userId, groupName: item.nickname } : {}),
                        userId: item.userId,
                        nickname: item.nickname.slice(0, 80),
                        remark: item.remark.slice(0, 80),
                        card: item.card.slice(0, 80),
                        role: item.role,
                    })),
                });
            } catch (error) {
                return Failed(`查询 OneBot 名单失败：${String(error)}`);
            }
        },
    };
    const removeTool = tools(ctx).registerTool(tool);
    ctx.on("dispose", () => {
        active = false;
        store.stop();
        if (typeof removeTool === "function") removeTool();
        else tools(ctx).unregisterTool(tool.name);
        modelUsage.clear();
    });

    ctx.command("onebot.contacts", "查询或刷新 OneBot 好友和群成员名单", { authority: 3 });
    function command(kind: Query["kind"]) {
        return ctx
            .command(`onebot.contacts.${kind}`, kind === "friends" ? "查询好友名单" : kind === "groups" ? "查询已加入的群" : "查询群成员名单", { authority: 3 })
            .option("groupId", "-g <groupId:string> 指定群号")
            .option("query", "-q <query:string> 按账号、昵称或群名模糊搜索")
            .option("offset", "-o <offset:natural> 跳过人数")
            .option("limit", "-n <limit:natural> 返回人数（默认 50）")
            .option("all", "--all 返回完整名单")
            .option("refresh", "-r 强制刷新")
            .action(async ({ session, options }) => {
                if (!session || !options) return h.text("会话不可用");
                try {
                    if (kind === "groups" && !session.isDirect) throw new Error("群列表只能在管理员私聊中查询");
                    const result = await store.query(onebot(session), {
                        kind,
                        groupId: groupId(session, options.groupId),
                        query: options.query,
                        offset: options.offset,
                        limit: options.limit,
                        all: options.all,
                        refresh: options.refresh,
                    });
                    const unit = kind === "groups" ? "个群" : "人";
                    const header = `${kind === "friends" ? "好友" : kind === "groups" ? "已加入的群" : `群 ${result.groupId} 成员`}：${result.total} ${unit}；本次 ${result.returned} ${unit}；缓存于 ${new Date(result.fetchedAt).toLocaleString()}（来源机器人 ${result.sourceBotId}）`;
                    const lines = result.entries.map(
                        (item, i) =>
                            `${result.offset + i + 1}. ${item.userId} ${item.card || item.remark || item.nickname}${item.role ? ` (${item.role})` : ""}`,
                    );
                    if (!lines.length) return h.text(header);
                    // Avoid a single huge platform message when --all is used.
                    for (let i = 0; i < lines.length; i += 40) {
                        await session.send(h.text(`${i === 0 ? header + "\n" : ""}${lines.slice(i, i + 40).join("\n")}`));
                    }
                } catch (error) {
                    return h.text(`查询 OneBot 名单失败：${String(error)}`);
                }
            });
    }
    command("friends");
    command("members");
    command("groups");
}
