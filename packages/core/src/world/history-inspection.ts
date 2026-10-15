import { Argv, Context, h } from "koishi";

import { getContextSnapshots } from "../model/context-snapshot";
import { estimateTokens, getUsageLedger, TokenUsage, UsageRecord } from "../model/usage";
import { TableName } from "../shared/constants";
import { HISTORY_CHANNELS } from "./channel-metadata";

const dimensions = ["adapter", "bot", "provider", "model", "target"] as const;
type Dimension = (typeof dimensions)[number];
const isDimension = (value: string): value is Dimension => dimensions.some((dimension) => dimension === value);
export interface InspectionOptions {
    adapter: string[];
    bot: string[];
    provider: string[];
    model: string[];
    target: string[];
    page: number;
    full: boolean;
    details: boolean;
    reset: boolean;
}

/** Koishi keeps only the final occurrence of ordinary options; read its preserved source. */
export function parseInspectionOptions(source: string, fallback: Record<string, any> = {}): InspectionOptions {
    const result: InspectionOptions = {
        adapter: [],
        bot: [],
        provider: [],
        model: [],
        target: [],
        page: 1,
        full: false,
        details: false,
        reset: false,
    };
    const tokens = Argv.parse(source || "").tokens || [];
    let explicitPage = false;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.quoted || !token.content.startsWith("--")) continue;
        const [name, ...inline] = token.content.slice(2).split("=");
        if (name === "full" || name === "details" || name === "reset" || name === "restart") {
            if (inline.length) throw new Error(`--${name} 不接受参数`);
            result[name === "restart" ? "reset" : name] = true;
            continue;
        }
        if (name !== "page" && !isDimension(name)) throw new Error(`未知参数 --${name}`);
        const next = inline.length ? inline.join("=") : tokens[++i]?.content;
        if (!next || next.startsWith("--")) throw new Error(`--${name} 缺少参数`);
        if (name === "page") {
            explicitPage = true;
            result.page = Number(next);
            if (!Number.isSafeInteger(result.page) || result.page < 1) throw new Error("页码必须为正整数");
        } else result[name].push(next);
    }
    for (const name of dimensions) {
        if (!result[name].length && fallback[name] !== undefined) result[name] = Array.isArray(fallback[name]) ? fallback[name] : [fallback[name]];
        result[name] = [...new Set(result[name])].sort();
    }
    for (const flag of ["full", "details", "reset"] as const) result[flag] ||= !!fallback[flag];
    result.reset ||= !!fallback.restart;
    if (!explicitPage && fallback.page !== undefined) {
        explicitPage = true;
        result.page = Number(fallback.page);
    }
    if (!Number.isSafeInteger(result.page) || result.page < 1) throw new Error("页码必须为正整数");
    if (result.reset && (dimensions.some((name) => result[name].length) || explicitPage || result.full || result.details)) {
        throw new Error("重置仅作用于整个实例，不能与筛选、分页或展示参数混用");
    }
    return result;
}

export function matchesUsage(record: Partial<UsageRecord>, options: InspectionOptions): boolean {
    const values = { adapter: record.platform, bot: record.botId, provider: record.provider, model: record.model, target: record.target };
    return dimensions.every(
        (name) =>
            !options[name].length ||
            (name === "target"
                ? options.target.some((target) => matchesTarget(record.platform, record.target, target))
                : options[name].includes(values[name] || "")),
    );
}

/** Runtime scopes store raw channel IDs; old snapshots may already contain a platform prefix. */
export function matchesTarget(platform: string | undefined, target: string | undefined, filter: string): boolean {
    if (!target) return false;
    // Colons can be part of a raw channel ID (OneBot private:123), not only a qualifier.
    if (filter === target || (platform && filter === `${platform}:${target}`)) return true;
    // Retain compatibility with snapshots which stored an already-qualified target.
    return !!platform && target.startsWith(`${platform}:`) && filter === target.slice(platform.length + 1);
}

export function formatUsage(value: TokenUsage, approximate = false): string {
    const display = (key: keyof TokenUsage) =>
        value[key] === null || value[key] === undefined ? "—" : `${approximate ? "≈" : ""}${(value[key] / 1000).toFixed(2)}K`;
    return `IN ${display("in")} · OUT ${display("out")} · CR ${display("cr")} · CW ${display("cw")} · Total ${display("total")}`;
}

function sumUsage(records: UsageRecord[], kind: "api" | "local"): TokenUsage {
    const result: TokenUsage = { in: null, out: null, cr: null, cw: null, total: null };
    for (const key of Object.keys(result) as Array<keyof TokenUsage>) {
        const known = records.map((row) => row[kind][key]).filter((value) => typeof value === "number");
        if (known.length) result[key] = known.reduce((a, b) => a + b, 0);
    }
    return result;
}

function usageLines(records: UsageRecord[]): string[] {
    const count = records.reduce((total, row) => total + (row.count ?? 1), 0);
    const unknown = (kind: "api" | "local", key: keyof TokenUsage) =>
        records.reduce((total, row) => total + (row[`${kind}Unknown`]?.[key] ?? (row[kind][key] === null ? (row.count ?? 1) : 0)), 0);
    return [
        `API   ${formatUsage(sumUsage(records, "api"))}`,
        `Local ${formatUsage(sumUsage(records, "local"), true)}`,
        `请求 ${count} 次；未知字段请求数：API ${["in", "out", "cr", "cw", "total"].map((key) => `${key.toUpperCase()} ${unknown("api", key as keyof TokenUsage)}`).join(" / ")}；Local ${["in", "out", "cr", "cw", "total"].map((key) => `${key.toUpperCase()} ${unknown("local", key as keyof TokenUsage)}`).join(" / ")}`,
    ];
}

function sourceName(row: UsageRecord): string {
    return `${row.platform || "实例后台"} / ${row.botId || "无机器人"} / ${row.target || "无目标"} / [${row.provider}][${row.model}] / ${row.purpose} / ${row.status}`;
}

function groupBy<T>(items: T[], key: (row: T) => string): Map<string, T[]> {
    const result = new Map<string, T[]>();
    for (const row of items) {
        const value = key(row);
        const bucket = result.get(value);
        if (bucket) bucket.push(row);
        else result.set(value, [row]);
    }
    return new Map([...result].sort(([a], [b]) => a.localeCompare(b)));
}

export function renderTokenLines(records: UsageRecord[], options: InspectionOptions): string[] {
    const lines = [...usageLines(records), "未知用量未计入合计；各字段只合计已知部分。缓存读取/写入不重复加入 Total。"];
    if (!records.length) return [...lines, "无匹配记录。"];
    const leaves = (rows: UsageRecord[]) => {
        for (const [name, values] of groupBy(rows, sourceName)) lines.push(`来源：${name}`, ...usageLines(values));
    };
    if (!options.full) leaves(records);
    else {
        const groups: Array<[string, (row: UsageRecord) => string]> = [
            ["适配器", (row) => row.platform || "实例后台"],
            ["服务商", (row) => row.provider],
            ["模型", (row) => `[${row.provider}][${row.model}]`],
            ["目标", (row) => `${row.platform || "实例后台"}/${row.botId || "无机器人"}/${row.target || "无目标"}`],
        ];
        lines.push("以下四类是同一批消耗的不同视角，不应再次相加。");
        for (const [label, key] of groups) {
            lines.push(`【按${label}】`);
            for (const [name, rows] of groupBy(records, key)) {
                lines.push(`${label}：${name}`, ...usageLines(rows));
                leaves(rows);
            }
        }
    }
    return lines;
}

/** Wrap literal content rather than truncate it to fit a transport page. */
export function paginateLines(lines: string[], size = 1800): string[][] {
    const pages: string[][] = [[]];
    let length = 0;
    for (const line of lines) {
        const chars = Array.from(line);
        do {
            if (length >= size) {
                pages.push([]);
                length = 0;
            }
            const part = chars.splice(0, Math.max(1, size - length)).join("");
            pages[pages.length - 1].push(part);
            length += Array.from(part).length + 1;
        } while (chars.length);
    }
    return pages;
}

export class InspectionPages {
    private entries = new Map<string, { period: string; expires: number; lines: string[] }>();
    constructor(
        private ttl = 5 * 60_000,
        private limit = 64,
    ) {}
    set(key: string, period: string, lines: string[], now = Date.now()): void {
        const size = lines.reduce((total, line) => total + line.length, 0);
        if (size > 8 * 1024 * 1024) throw new Error("完整查询结果超过快照容量，请缩小筛选范围；未截断内容。");
        this.entries.delete(key);
        for (const [id, entry] of this.entries) if (entry.expires <= now) this.entries.delete(id);
        while (this.entries.size >= this.limit) this.entries.delete(this.entries.keys().next().value!);
        while (
            [...this.entries.values()].reduce((total, entry) => total + entry.lines.reduce((bytes, line) => bytes + line.length, 0), size) >
            16 * 1024 * 1024
        )
            this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(key, { period, expires: now + this.ttl, lines });
    }
    get(key: string, period: string, now = Date.now()): string[] | undefined {
        const entry = this.entries.get(key);
        if (!entry || entry.period !== period || entry.expires <= now) {
            this.entries.delete(key);
            return;
        }
        return entry.lines;
    }
    clear(): void {
        this.entries.clear();
    }
}

/** The legacy DB is shared by target, not by bot. Respect the plugin's Koishi filter. */
function visibleTarget(ctx: Context, platform: string, channelId: string, channelType?: string): boolean {
    if (!platform || !channelId) return false;
    return ctx.bots.some((bot) => {
        if (bot.platform !== platform) return false;
        const visible = (type: "private" | "guild") =>
            ctx.filter(
                bot.session({
                    platform,
                    selfId: bot.selfId,
                    channel: { id: channelId, type: type === "private" ? 1 : 0 },
                    guild: type === "private" ? undefined : { id: channelId },
                } as any),
            );
        return channelType === "private" || channelType === "guild" ? visible(channelType) : visible("private") && visible("guild");
    });
}

async function contextLines(ctx: Context, options: InspectionOptions): Promise<string[]> {
    const lines = [
        "本地历史按平台/目标共享保存，旧记录没有机器人或实例标识。这里只显示当前实例可见目标。",
        "存储容量为文本估算，不等于实际请求长度；图片、嵌入向量不计入文本容量。",
    ];
    if (options.provider.length || options.model.length || options.bot.length)
        lines.push("服务商、模型、机器人筛选仅作用于实际请求快照；共享存储不归属某一模型或机器人。");
    else {
        let storedTokens = 0;
        let unknownText = 0;
        const channelTypes = new Map<string, string>();
        for (let offset = 0; ; offset += 500) {
            const rows = await ctx.database.get(
                HISTORY_CHANNELS,
                {},
                { fields: ["platform", "channelId", "channelType"], limit: 500, offset, sort: { platform: "asc", channelId: "asc" } },
            );
            for (const row of rows)
                if (row.channelType === "guild" || row.channelType === "private")
                    channelTypes.set(JSON.stringify([row.platform, row.channelId]), row.channelType);
            if (rows.length < 500) break;
        }
        const tables: Array<[string, string, string[]]> = [
            [TableName.Messages, "历史消息（非实际 L1 窗口）", ["id", "platform", "channelId", "channelType", "timestamp", "content"]],
            [TableName.SystemEvents, "系统事件", ["platform", "channelId", "channelType", "timestamp", "type", "message", "payload", "eventScope", "botKey"]],
            [TableName.L2Chunks, "L2 摘要", ["platform", "channelId", "content", "startTimestamp", "endTimestamp"]],
            [TableName.L3Diaries, "L3 日记", ["platform", "channelId", "content", "date", "keywords"]],
        ];
        for (const [table, label, fields] of tables) {
            const query: any = options.adapter.length ? { platform: { $in: options.adapter } } : {};
            const groups = new Map<string, { count: number; tokens: number; unknown: number; first?: string; last?: string }>();
            const details: string[] = [];
            let omittedUntyped = 0;
            let omittedScope = 0;
            for (let offset = 0; ; offset += 500) {
                const rows: any[] = await ctx.database.get(table as any, query, { fields, limit: 500, offset, sort: { id: "asc" } } as any);
                for (const row of rows) {
                    if (table === TableName.SystemEvents && ["bot", "mind", "global"].includes(row.eventScope)) {
                        omittedScope++;
                        continue;
                    }
                    if (options.target.length && !options.target.some((target) => matchesTarget(row.platform, row.channelId, target))) continue;
                    const recordedType = row.channelType === "private" || row.channelType === "guild" ? row.channelType : undefined;
                    const metadataType = channelTypes.get(JSON.stringify([row.platform, row.channelId]));
                    const type = recordedType && metadataType && recordedType !== metadataType ? undefined : recordedType || metadataType;
                    if (!visibleTarget(ctx, row.platform, row.channelId, type)) {
                        if (!type) omittedUntyped++;
                        continue;
                    }
                    const target = `${row.platform}:${row.channelId}`;
                    if (!groups.has(target)) groups.set(target, { count: 0, tokens: 0, unknown: 0 });
                    const group = groups.get(target)!;
                    group.count++;
                    const tokens = estimateTokens(table === TableName.SystemEvents ? { message: row.message, payload: row.payload } : row.content);
                    if (tokens === null) {
                        group.unknown++;
                        unknownText++;
                    } else {
                        group.tokens += tokens;
                        storedTokens += tokens;
                    }
                    const time = row.timestamp || row.startTimestamp || row.date;
                    if (time && Number.isFinite(new Date(time).getTime())) {
                        const value = new Date(time).toISOString();
                        if (!group.first || value < group.first) group.first = value;
                        if (!group.last || value > group.last) group.last = value;
                    }
                    if (options.details) details.push(`${label} ${target}`, JSON.stringify(row, null, 2));
                }
                if (details.reduce((total, line) => total + line.length, 0) > 8 * 1024 * 1024)
                    throw new Error("完整历史内容超过查询快照容量，请用 --target 缩小范围后重试；未截断内容。");
                if (rows.length < 500) break;
            }
            lines.push(`${label}：${[...groups.values()].reduce((total, group) => total + group.count, 0)} 条`);
            if (omittedUntyped) lines.push(`  类型未知或冲突，无法确认可见范围，已略过 ${omittedUntyped} 条。`);
            if (omittedScope) lines.push(`  非频道事件无法确认实例归属，已略过 ${omittedScope} 条；可在实际请求快照查看已注入事件。`);
            for (const [target, group] of [...groups].sort(([a], [b]) => a.localeCompare(b)))
                lines.push(
                    `  ${target}：${group.count} 条 · 文本 ≈${(group.tokens / 1000).toFixed(2)}K · 未知 ${group.unknown} 条 · ${group.first || "未知时间"} 至 ${group.last || "未知时间"}`,
                );
            lines.push(...details);
        }
        const blocks = ctx.yesimbot?.memory?.getMemoryBlocksForRendering() || [];
        const memoryTokens = estimateTokens(blocks);
        lines.push(
            `【实例核心记忆】${blocks.length} 个区块 · 文本 ${memoryTokens === null ? "未知" : `≈${(memoryTokens / 1000).toFixed(2)}K`}（共享记忆，不归属单个目标）`,
        );
        if (options.details) lines.push(JSON.stringify(blocks, null, 2));
        if (memoryTokens === null) unknownText++;
        else storedTokens += memoryTokens;
        lines.unshift(`【本地保存容量】已知文本合计 ≈${(storedTokens / 1000).toFixed(2)}K · 无法估算 ${unknownText} 项`);
    }
    const snapshots = getContextSnapshots(ctx).filter((row) =>
        matchesUsage({ platform: row.adapter, botId: row.bot, target: row.target, provider: row.provider, model: row.model } as any, options),
    );
    if (options.full) {
        const groups: Array<[string, (row: (typeof snapshots)[number]) => string]> = [
            ["适配器", (row) => row.adapter || "实例后台"],
            ["服务商", (row) => row.provider],
            ["模型", (row) => `[${row.provider}][${row.model}]`],
            ["目标", (row) => `${row.adapter || "实例后台"}/${row.bot || "无机器人"}/${row.target || "无目标"}`],
        ];
        for (const [label, key] of groups) {
            lines.push(`【请求快照按${label}】`);
            for (const [name, rows] of groupBy(snapshots, key)) {
                lines.push(`${name}：${rows.length} 个最近快照`);
                for (const row of rows)
                    lines.push(
                        `  来源：${row.adapter || "实例后台"}/${row.bot || "无机器人"}/${row.target || "无目标"}/[${row.provider}][${row.model}]/${row.purpose || "请求"}`,
                    );
            }
        }
    }
    lines.push(`【实际请求上下文】最近快照 ${snapshots.length} 条；仅本次运行记录，不代表全部历史请求。`);
    for (const row of snapshots) {
        lines.push(
            `${new Date(row.timestamp).toISOString()} ${row.adapter || "实例后台"}/${row.bot || "无机器人"}/${row.target || "无目标"} [${row.provider}][${row.model}] ${row.purpose || "请求"}`,
            `输入文本 ${row.inputTokens === undefined ? "未知" : `≈${(row.inputTokens / 1000).toFixed(2)}K`}`,
        );
        const capacity = ctx.yesimbot?.model?.peekContextLimit(row.provider, row.model);
        if (capacity)
            lines.push(
                `最大上下文：${capacity.tokens === undefined ? "未知" : `${capacity.tokens / 1000}K`} · ${capacity.mode} · ${capacity.source || capacity.reason || capacity.status}${capacity.checkedAt ? ` · ${new Date(capacity.checkedAt).toISOString()}` : ""}`,
            );
        if (row.unavailable) lines.push(`完整内容不可用：${row.unavailable}`);
        else if (options.details) lines.push(row.content || "无内容");
    }
    return lines;
}

export function registerHistoryInspection(ctx: Context, historyCmd: any): void {
    const cache = new InspectionPages();
    for (const kind of ["tokens", "context"] as const) {
        const command = historyCmd.subcommand(`.${kind}`, kind === "tokens" ? "查询实例用量统计" : "只读查看实例上下文", { authority: 3 });
        for (const name of dimensions) command.option(name, `--${name} <value:string> 筛选${name}（可重复）`);
        command.option("page", "--page <page:posint> 页码").option("full", "--full 按类别展开");
        if (kind === "tokens") command.option("reset", "--reset 重置整个实例统计").option("restart", "--restart 重置整个实例统计");
        else command.option("details", "--details 展示完整存储内容和请求快照");
        command.action(async (argv: any) => {
            try {
                const options = parseInspectionOptions(argv.source || argv.session?.argv?.source || "", argv.options || {});
                const ledger = getUsageLedger(ctx);
                if (options.reset) {
                    if (kind !== "tokens") return "仅 history.tokens 支持重置。";
                    const actor = `${argv.session.platform}:${argv.session.userId}`;
                    await ledger.reset(actor);
                    cache.clear();
                    return "已重置当前实例全部用量统计并清除旧请求快照，开始新统计周期。聊天历史与记忆未清除。";
                }
                const snapshot = await ledger.snapshot();
                const filter = JSON.stringify({ ...options, page: undefined });
                const key = JSON.stringify([kind, argv.session.platform, argv.session.userId, filter]);
                const fullScope =
                    dimensions
                        .filter((name) => options[name].length)
                        .map((name) => `${name}=${options[name].join(" | ")}`)
                        .join("；") || "整个插件实例";
                let lines = options.page > 1 ? cache.get(key, snapshot.period) : undefined;
                if (options.page > 1 && !lines) return "查询快照已过期或不存在，请以相同条件重新查询第 1 页。";
                if (!lines) {
                    lines =
                        kind === "tokens"
                            ? renderTokenLines(
                                  snapshot.records.filter((row) => matchesUsage(row, options)),
                                  options,
                              )
                            : await contextLines(ctx, options);
                    if (fullScope.length > 256) lines.push("【完整筛选条件】", fullScope);
                    cache.set(key, snapshot.period, lines);
                }
                const pages = paginateLines(lines);
                if (options.page > pages.length) return `页码超出范围，共 ${pages.length} 页。`;
                const scope =
                    fullScope.length <= 256
                        ? fullScope
                        : `${dimensions
                              .filter((name) => options[name].length)
                              .map((name) => `${name} ${options[name].length} 项`)
                              .join("；")}（完整条件见正文）`;
                const header = [
                    `范围：${scope}`,
                    `统计起点：${new Date(snapshot.startedAt).toISOString()} · 周期 ${snapshot.period}`,
                    `第 ${options.page}/${pages.length} 页 · 1K=1000 token`,
                ];
                if (kind === "tokens" && options.page > 1) header.push("范围总量（查询快照）：", ...lines.slice(0, 3));
                return h
                    .text(
                        [
                            ...header,
                            ...pages[options.page - 1],
                            ...(pages.length > options.page ? [`下一页：使用相同条件追加 --page ${options.page + 1}`] : []),
                        ].join("\n"),
                    )
                    .toString();
            } catch (error) {
                return h.text(`查询失败：${error instanceof Error ? error.message : String(error)}`).toString();
            }
        });
    }
}
