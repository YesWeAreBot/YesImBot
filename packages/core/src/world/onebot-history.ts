import { Argv, Context, Logger, Session, Universal } from "koishi";
import { CQCode, OneBot } from "koishi-plugin-adapter-onebot";

import type { AssetService } from "../asset";
import { TableName } from "../shared/constants";
import type { HistoryConfig } from "./config";
import { normalizeOneBotMessageContent } from "./onebot-faces";
import type { WorldStateService } from "./service";

type BackfillSource = NonNullable<import("./types").MessageData["sender"]["discovery"]>;
type NativeMessage = Parameters<typeof OneBot.adaptMessage>[1] & { target_id?: string | number; user_id?: string | number };

interface Target {
    session: Session;
    channelId: string;
    floor: number;
    generation: number;
    task?: Promise<BackfillResult>;
}

export interface BackfillResult {
    fetched: number;
    stored: number;
    skipped: number;
    failed: number;
    messageIds: string[];
}

const numericId = (value: unknown) => (typeof value === "string" && /^-?\d+$/.test(value)) || Number.isSafeInteger(value);
const PAGE_SIZE = 30;
const MAX_PAGES = 3;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_TARGETS = 256;
const BACKGROUND_TARGETS_PER_TICK = 4;

function belongsToTarget(row: NativeMessage, session: Session, channelId: string): boolean {
    if (!row || !numericId(row.message_id) || !numericId(row.sender?.user_id) || !Number.isSafeInteger(row.time)) return false;
    if (!Array.isArray(row.message) && typeof row.message !== "string") return false;
    if (!session.isDirect) return row.message_type === "group" && String(row.group_id) === channelId && !row.guild_id;
    if (row.message_type !== "private" || row.group_id || row.guild_id) return false;
    const peer = channelId.slice("private:".length);
    const sender = String(row.sender.user_id);
    // An outbound private message must identify the destination explicitly.
    return sender === peer || (sender === session.selfId && String(row.target_id) === peer);
}

export class OneBotHistoryBackfill {
    private readonly targets = new Map<string, Target>();
    private stopTimer?: () => void;
    private stopStatus?: () => void;
    private stopped = true;
    private ticking = false;

    constructor(
        private readonly ctx: Context,
        private readonly settings: HistoryConfig["onebotHistory"],
        private readonly world: WorldStateService,
        private readonly asset: AssetService,
        private readonly logger: Logger,
    ) {}

    start(): void {
        if (!this.settings?.enabled || !this.stopped) return;
        this.stopped = false;
        this.stopTimer = this.ctx.setInterval(() => this.runTick(), this.settings.intervalSeconds * 1000);
        this.stopStatus = this.ctx.on("bot-status-updated", () => this.runTick());
    }

    stop(): void {
        this.stopped = true;
        this.stopTimer?.();
        this.stopStatus?.();
        this.targets.clear();
    }

    observe(session: Session): void {
        if (!this.allowed(session)) return;
        const channelId = session.channelId!;
        const key = JSON.stringify([session.platform, session.selfId, channelId]);
        const current = this.targets.get(key);
        if (current) {
            current.session = session;
            return;
        }
        if (this.targets.size >= MAX_TARGETS) return;
        // An explicit clear must not be undone by platform history, including
        // after restart. Only fill gaps after observing this target this run.
        const floor = Math.floor(Date.now() / 1000) * 1000;
        this.targets.set(key, { session, channelId, floor, generation: this.world.l2_manager.getHistoryGeneration({ platform: "onebot", channelId }) });
    }

    async refresh(session: Session, messageId?: string, source: BackfillSource = "onebot-tool"): Promise<BackfillResult> {
        if (!this.allowed(session)) throw new Error("当前会话未启用 OneBot 历史补录");
        this.observe(session);
        const target = this.targets.get(JSON.stringify([session.platform, session.selfId, session.channelId]));
        if (!target) throw new Error("OneBot 历史补录会话已达上限");
        if (messageId !== undefined) {
            if (!numericId(messageId) || !Number.isSafeInteger(Number(messageId))) throw new Error("消息 ID 不可用于 OneBot 回读");
            return this.syncPage(target, source, messageId);
        }
        return this.sync(target, source);
    }

    private allowed(session: Session): boolean {
        const channel = session.channelId ?? "";
        return (
            !this.stopped &&
            session.platform === "onebot" &&
            !!session.selfId &&
            !!session.bot?.internal &&
            (session.isDirect ? /^private:\d+$/.test(channel) : /^\d+$/.test(channel) && session.guildId === channel) &&
            this.ctx.filter(session) &&
            this.world.isChannelAllowed(session)
        );
    }

    private async runTick(): Promise<void> {
        if (this.ticking || this.stopped) return;
        this.ticking = true;
        try {
            for (const [key, target] of [...this.targets].slice(0, BACKGROUND_TARGETS_PER_TICK)) {
                this.targets.delete(key);
                this.targets.set(key, target);
                if (!this.allowed(target.session) || target.session.bot.status !== Universal.Status.ONLINE) continue;
                try {
                    await this.sync(target, "onebot-periodic");
                } catch (error) {
                    this.logger.debug(`OneBot 历史补录未完成 · ${target.channelId} · ${error.name ?? "未知错误"}`);
                }
            }
        } finally {
            this.ticking = false;
        }
    }

    private sync(target: Target, source: BackfillSource): Promise<BackfillResult> {
        if (target.task) return target.task;
        const job = this.syncPage(target, source).finally(() => {
            if (target.task === job) target.task = undefined;
        });
        target.task = job;
        return job;
    }

    private async syncPage(target: Target, source: BackfillSource, messageId?: string): Promise<BackfillResult> {
        const { session, channelId } = target;
        const scope = { platform: "onebot", channelId };
        await this.world.l2_manager.waitForHistoryClear(scope);
        const generation = this.world.l2_manager.getHistoryGeneration(scope);
        if (target.generation !== generation) {
            target.generation = generation;
            target.floor = (Math.floor(Date.now() / 1000) + 1) * 1000;
        }
        const assertCurrent = () => {
            if (!this.allowed(session) || session.channelId !== channelId || this.world.l2_manager.getHistoryGeneration(scope) !== generation)
                throw new Error("补录期间会话授权或历史状态已改变");
        };
        assertCurrent();
        const internal = session.bot.internal;
        if (typeof internal?._get !== "function") throw new Error("当前适配器没有 OneBot 历史查询接口");
        const nativeTarget = Number(session.isDirect ? channelId.slice(8) : channelId);
        if (!Number.isSafeInteger(nativeTarget) || nativeTarget <= 0) throw new Error("OneBot 历史查询目标 ID 无效");
        const params = session.isDirect ? { user_id: nativeTarget, count: PAGE_SIZE } : { group_id: nativeTarget, count: PAGE_SIZE };
        const action = session.isDirect ? "get_friend_msg_history" : "get_group_msg_history";
        const request = async (method: string, params: object) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const response = await Promise.race([
                internal._get(method, params),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error("OneBot 历史查询超时")), REQUEST_TIMEOUT_MS);
                }),
            ]).finally(() => clearTimeout(timer));
            assertCurrent();
            return response;
        };
        const native: NativeMessage[] = [];
        if (messageId !== undefined) {
            native.push(await request("get_msg", { message_id: Number(messageId) }));
        } else {
            const cursors = new Set<string>();
            let cursorParams = {};
            for (let page = 0; page < MAX_PAGES; page++) {
                let reply;
                try {
                    reply = await request(action, { ...params, ...cursorParams });
                } catch (error) {
                    if (!page) throw error;
                    // Older adapters may accept the initial read without paging support.
                    break;
                }
                const messages: NativeMessage[] = Array.isArray(reply) ? reply : reply?.messages;
                if (!Array.isArray(messages)) {
                    if (!page) throw new Error("OneBot 历史响应未返回消息列表");
                    break;
                }
                const batch = messages.slice(0, PAGE_SIZE);
                native.push(...batch);
                if (batch.length < PAGE_SIZE) break;
                const oldest = batch
                    .filter((row) => belongsToTarget(row, session, channelId))
                    .sort((a, b) => a.time - b.time || Number(a.message_seq) - Number(b.message_seq))[0];
                if (!oldest || oldest.time * 1000 < target.floor) break;
                const snowluma = this.settings?.backend === "snowluma";
                const cursor = snowluma ? oldest.message_id : oldest.message_seq;
                if (!numericId(cursor) || cursors.has(String(cursor))) break;
                cursors.add(String(cursor));
                if (snowluma && !Number.isSafeInteger(Number(cursor))) break;
                cursorParams = snowluma ? { message_id: Number(cursor), reverse_order: true } : { message_seq: String(cursor), reverseOrder: false };
            }
            assertCurrent();
        }
        const result: BackfillResult = { fetched: native.length, stored: 0, skipped: 0, failed: 0, messageIds: [] };
        const rows = native
            .filter(
                (row) =>
                    belongsToTarget(row, session, channelId) &&
                    row.time * 1000 >= target.floor &&
                    (messageId === undefined || String(row.message_id) === messageId),
            )
            .sort((a, b) => a.time - b.time);
        result.skipped = result.fetched - rows.length;
        if (!rows.length) return result;
        const known = await this.ctx.database.get(TableName.Messages, { ...scope, id: { $in: rows.map((row) => String(row.message_id)) } }, ["id"]);
        const seen = new Set(known.map((row) => row.id));
        for (const row of rows) {
            assertCurrent();
            const id = String(row.message_id);
            // Historical payloads cannot distinguish our protected command output
            // from ordinary bot replies. Live send receipts retain this metadata.
            if (seen.has(id) || String(row.sender.user_id) === session.selfId) {
                result.skipped++;
                continue;
            }
            try {
                // Strip the detached quote before invoking the adapter decoder;
                // its reply lookup fetches another message and can recurse.
                const chain = CQCode.parse(row.message);
                const quoteId = chain[0]?.type === "reply" ? String(chain.shift()!.attrs.id) : undefined;
                const message = await OneBot.adaptMessage(session.bot as any, {
                    ...row,
                    message: chain.map((part) => ({ type: part.type, data: part.type === "text" ? { text: part.attrs.content } : part.attrs })),
                });
                const event = session.bot.session({
                    type: "message",
                    channel: session.event.channel ? { ...session.event.channel } : undefined,
                    guild: session.event.guild ? { ...session.event.guild } : undefined,
                    user: { id: String(row.sender.user_id), name: row.sender.nickname },
                    message: { id, content: message.content },
                    timestamp: row.time * 1000,
                });
                const content = await normalizeOneBotMessageContent(event);
                // Configuration command inputs are intentionally excluded by
                // live capture too. Never reintroduce their arguments.
                const text = event.stripped.content;
                const argv = Argv.parse(text);
                argv.session = event;
                const name = this.ctx.$commander.inferCommand(argv)?.name;
                if (name === "conf" || name?.startsWith("conf.") || /(?:^|\s)[!/＃#.]*(?:yib\.)?conf(?:[.\s]|$)/i.test(text)) {
                    result.skipped++;
                    continue;
                }
                const transformed = await this.asset.transform(content, { session: event });
                assertCurrent();
                const outcome = await this.world.recordMessage(
                    {
                        ...scope,
                        id,
                        channelType: session.isDirect ? "private" : "guild",
                        sender: { id: String(row.sender.user_id), name: row.sender.card || row.sender.nickname, discovery: source },
                        content: transformed,
                        timestamp: new Date(row.time * 1000),
                        quoteId,
                    },
                    generation,
                    { backfilled: true },
                );
                if (outcome === "stored") {
                    result.stored++;
                    result.messageIds.push(id);
                    seen.add(id);
                } else if (outcome === "duplicate") result.skipped++;
                else result.failed++;
            } catch (error) {
                assertCurrent();
                result.failed++;
                this.logger.debug(`OneBot 历史消息补录失败 · ${channelId} · 消息 ${id} · ${error.name ?? "未知错误"}`);
            }
        }
        return result;
    }
}
