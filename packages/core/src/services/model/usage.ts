import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Context } from "koishi";

import { Services } from "../../shared/constants";
import { captureContextSnapshot, clearContextSnapshots, MAX_CONTEXT_SNAPSHOT_BYTES } from "./context-snapshot";
import { resolveUsageOwner, UsageOwner } from "./usage-owner";

export interface TokenUsage {
    in: number | null;
    out: number | null;
    cr: number | null;
    cw: number | null;
    total: number | null;
}
export interface UsageScope {
    purpose?: string;
    platform?: string;
    botId?: string;
    target?: string;
}
export interface UsageMetadata extends UsageScope {
    provider: string;
    model: string;
}
export interface UsageRecord extends UsageMetadata {
    id: string;
    period: string;
    time: number;
    purpose: string;
    status: string;
    api: TokenUsage;
    local: TokenUsage;
    localApproximate: true;
    count: number;
    lastTime: number;
    apiUnknown: Record<keyof TokenUsage, number>;
    localUnknown: Record<keyof TokenUsage, number>;
}
export interface UsageTicket extends UsageMetadata {
    id: string;
    period: string;
    time: number;
}
const scopes = new AsyncLocalStorage<UsageScope>();
export function withUsageScope<T>(scope: UsageScope, fn: () => T, inherit = true): T {
    return scopes.run({ ...(inherit ? scopes.getStore() : {}), ...Object.fromEntries(Object.entries(scope).filter(([, value]) => value !== undefined)) }, fn);
}
const number = (...values: unknown[]): number | null =>
    (values.find((value) => typeof value === "number" && Number.isFinite(value) && value >= 0) as number) ?? null;
const emptyUsage = (): TokenUsage => ({ in: null, out: null, cr: null, cw: null, total: null });

/** Anthropic excludes cached input from input_tokens; OpenAI includes it in prompt_tokens. */
export function normalizeUsage(value: any): TokenUsage {
    if (!value || typeof value !== "object") return emptyUsage();
    let input = number(value.prompt_tokens, value.input_tokens, value.promptTokens, value.inputTokens);
    if (input === null && typeof value.prompt_cache_miss_tokens === "number" && typeof value.prompt_cache_hit_tokens === "number")
        input = number(value.prompt_cache_miss_tokens + value.prompt_cache_hit_tokens);
    const out = number(value.completion_tokens, value.output_tokens, value.completionTokens, value.outputTokens);
    const cr = number(
        value.prompt_tokens_details?.cached_tokens,
        value.input_tokens_details?.cached_tokens,
        value.cache_read_input_tokens,
        value.prompt_cache_hit_tokens,
        value.cached_tokens,
    );
    const cw = number(
        value.cache_creation_input_tokens,
        value.cache_creation && number(value.cache_creation.ephemeral_5m_input_tokens, value.cache_creation.ephemeral_1h_input_tokens) !== null
            ? (number(value.cache_creation.ephemeral_5m_input_tokens) ?? 0) + (number(value.cache_creation.ephemeral_1h_input_tokens) ?? 0)
            : undefined,
        value.prompt_tokens_details?.cache_write_tokens,
        value.input_tokens_details?.cache_write_tokens,
    );
    if (value.prompt_tokens === undefined && input !== null && (value.cache_read_input_tokens !== undefined || value.cache_creation_input_tokens !== undefined))
        input += (cr ?? 0) + (cw ?? 0);
    return {
        in: input,
        out,
        cr,
        cw,
        total: number(value.total_tokens, value.totalTokens) ?? (input !== null && out !== null ? input + out : null),
    };
}

/** Text heuristic only; image/audio payloads cannot be inferred from byte size. */
export function estimateTokens(value: unknown): number | null {
    if (value == null) return null;
    try {
        let multimodal = false;
        const text =
            typeof value === "string"
                ? value
                : JSON.stringify(value, (key, item) => {
                      if (["image_url", "input_audio", "audio", "video_url"].includes(key) || (key === "type" && /image|audio|video/.test(String(item))))
                          multimodal = true;
                      return item;
                  });
        if (text === "") return 0;
        if (multimodal || !text || /data:(?:image|audio|video)\//.test(text)) return null;
        const cjk = (text.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []).length;
        return Math.ceil(cjk + (text.length - cjk) / 4);
    } catch {
        return null;
    }
}

const usageRecordKey = (record: UsageMetadata & { status: string }) =>
    JSON.stringify([record.provider, record.model, record.platform, record.botId, record.target, record.purpose ?? "未分类", record.status]);

export class UsageLedger {
    private period = randomUUID();
    private startedAt = Date.now();
    private records: UsageRecord[] = [];
    private completed = new Set<string>();
    private readonly pending = new Map<string, UsageTicket>();
    private closed = false;
    private closing?: Promise<void>;
    private writes: Promise<void> = Promise.resolve();
    private writing = false;
    private dirty = false;
    private persistenceEnabled = true;
    private readonly loading: Promise<void>;
    private loaded = false;
    private readonly initializingTickets: UsageTicket[] = [];
    public constructor(
        private readonly file: string,
        private readonly warn: (message: string) => void,
        private readonly onReset?: () => void,
    ) {
        this.loading = this.load().then(() => {
            this.loaded = true;
            for (const ticket of this.initializingTickets) ticket.period = this.period;
            this.initializingTickets.length = 0;
        });
    }
    private async load(): Promise<void> {
        try {
            const data = JSON.parse(await readFile(this.file, "utf8"));
            if (
                data.version !== 1 ||
                typeof data.period !== "string" ||
                !Number.isFinite(data.startedAt) ||
                !Array.isArray(data.records) ||
                !data.records.every(
                    (record: any) =>
                        record && Number.isInteger(record.count) && record.count > 0 && record.api && record.local && record.apiUnknown && record.localUnknown,
                )
            )
                throw new Error("统计文件格式无效");
            this.period = data.period;
            this.startedAt = data.startedAt;
            this.records = data.records;
        } catch (error) {
            if (error.code !== "ENOENT") {
                try {
                    await rename(this.file, `${this.file}.corrupt-${Date.now()}`);
                    this.warn(`统计文件无效，已隔离原文件并开始新周期: ${error.message}`);
                } catch {
                    this.persistenceEnabled = false;
                    this.warn(`统计文件读取失败，停止写入以保留原文件: ${error.message}`);
                }
            }
        }
    }
    public ready(): Promise<void> {
        return this.loading;
    }
    public begin(metadata: UsageMetadata): UsageTicket {
        if (this.closed) throw new Error("用量统计实例已停止");
        const ticket = {
            ...metadata,
            ...scopes.getStore(),
            provider: metadata.provider,
            model: metadata.model,
            id: randomUUID(),
            period: this.period,
            time: Date.now(),
        };
        if (!this.loaded) this.initializingTickets.push(ticket);
        this.pending.set(ticket.id, ticket);
        return ticket;
    }
    public async finish(ticket: UsageTicket, result: { api?: unknown; input?: unknown; output?: unknown; status?: string }): Promise<void> {
        return this.finishRecord(ticket, result);
    }
    private async finishRecord(
        ticket: UsageTicket,
        result: { api?: unknown; input?: unknown; output?: unknown; status?: string },
        stopped = false,
    ): Promise<void> {
        await this.ready();
        if ((this.closed && !stopped) || ticket.period !== this.period || this.completed.has(ticket.id)) return;
        this.pending.delete(ticket.id);
        this.completed.add(ticket.id);
        const input = estimateTokens(result.input),
            output = estimateTokens(result.output);
        const api = normalizeUsage(result.api);
        const local: TokenUsage = {
            in: input,
            out: output,
            cr: null,
            cw: null,
            total: input !== null && output !== null ? input + output : null,
        };
        const status = result.status ?? "success",
            purpose = ticket.purpose ?? "未分类";
        let record = this.records.find((record) => usageRecordKey(record) === usageRecordKey({ ...ticket, purpose, status }));
        if (!record) {
            record = {
                ...ticket,
                purpose,
                status,
                count: 0,
                lastTime: ticket.time,
                api: emptyUsage(),
                local: emptyUsage(),
                apiUnknown: { in: 0, out: 0, cr: 0, cw: 0, total: 0 },
                localUnknown: { in: 0, out: 0, cr: 0, cw: 0, total: 0 },
                localApproximate: true,
            };
            this.records.push(record);
        }
        record.count++;
        record.lastTime = ticket.time;
        for (const field of ["in", "out", "cr", "cw", "total"] as const) {
            if (api[field] === null) record.apiUnknown[field]++;
            else record.api[field] = (record.api[field] ?? 0) + api[field];
            if (local[field] === null) record.localUnknown[field]++;
            else record.local[field] = (record.local[field] ?? 0) + local[field];
        }
        // A ticket is normally finalized by its transport once; bound defensive deduplication.
        if (this.completed.size > 10000) this.completed.delete(this.completed.values().next().value!);
        await this.persist();
    }
    private persist(): Promise<void> {
        if (!this.persistenceEnabled) return Promise.resolve();
        this.dirty = true;
        if (this.writing) return this.writes;
        this.writing = true;
        this.writes = (async () => {
            try {
                while (this.dirty) {
                    // Coalesce concurrent calls, writing the current state rather than stale snapshots.
                    await new Promise((resolve) => setTimeout(resolve, 25));
                    this.dirty = false;
                    const content = JSON.stringify({ version: 1, period: this.period, startedAt: this.startedAt, records: this.records });
                    await mkdir(path.dirname(this.file), { recursive: true });
                    const temp = `${this.file}.${randomUUID()}.tmp`;
                    await writeFile(temp, content, { mode: 0o600 });
                    await rename(temp, this.file);
                }
            } catch (error) {
                this.warn(`保存用量统计失败: ${error.message}`);
            } finally {
                this.writing = false;
            }
        })();
        return this.writes;
    }
    public async flush(): Promise<void> {
        await this.ready();
        await this.writes;
    }
    public async snapshot(): Promise<{ period: string; startedAt: number; records: UsageRecord[] }> {
        await this.ready();
        await this.flush();
        return { period: this.period, startedAt: this.startedAt, records: structuredClone(this.records) };
    }
    public close(): Promise<void> {
        if (this.closing) return this.closing;
        // Fence first: late requests cannot overwrite a reloaded instance's file.
        this.closed = true;
        this.closing = (async () => {
            await this.ready();
            await Promise.all([...this.pending.values()].map((ticket) => this.finishRecord(ticket, { status: "stopped" }, true)));
            this.pending.clear();
            await this.flush();
        })();
        return this.closing;
    }
    public async reset(actor?: string): Promise<void> {
        await this.ready();
        if (this.closed) throw new Error("用量统计实例已停止");
        this.pending.clear();
        this.period = randomUUID();
        this.startedAt = Date.now();
        this.records = [];
        this.completed.clear();
        this.onReset?.();
        this.warn(`用量统计已重置 | 操作者: ${actor ?? "未知"} | 时间: ${new Date(this.startedAt).toISOString()}`);
        await this.persist();
    }
}
const ledgers = new WeakMap<object, UsageLedger>();
function warnUsage(ctx: Context, message: string): void {
    // Telemetry must remain optional, including in isolated model integrations.
    try {
        const logger = ctx[Services.Logger]?.getLogger?.("[用量统计]") ?? (typeof ctx.logger === "function" ? ctx.logger("yesimbot-usage") : undefined);
        logger?.warn?.(message);
    } catch {
        /* logging failure cannot affect a model request */
    }
}
export function getUsageLedger(ctx: Context, explicitOwner?: UsageOwner): UsageLedger {
    const usageOwner = resolveUsageOwner(ctx, explicitOwner);
    const owner = usageOwner?.context ?? ctx;
    if (typeof owner.baseDir !== "string" || !owner.baseDir) throw new Error("缺少插件数据目录，跳过用量统计");
    const identity = usageOwner ?? ctx;
    let ledger = ledgers.get(identity);
    if (ledger) return ledger;
    const keys: string[] = [];
    const seen = new Set<object>();
    let scope: any = owner.scope;
    while (scope && !seen.has(scope)) {
        seen.add(scope);
        const next = scope.parent?.scope;
        if (scope.key) keys.push(String(scope.key));
        else if (scope.runtime === scope && next !== scope) {
            // Loader assigns keys to the returned ForkScope, while plugin code
            // runs in its MainScope. Follow the same edge as loader.paths().
            const children = scope.children ?? [];
            const keyed = children.filter((child: any) => typeof child.key === "string" && child.key);
            if (keyed.length === 1 && children.length === 1) keys.push(keyed[0].key);
            else if (keyed.length) {
                // A reusable MainScope with multiple forks has no unambiguous
                // owner here; never combine its keys into a shared namespace.
                if (!keys.length) warnUsage(owner, "插件作用域含多个配置入口，无法唯一识别持久化统计归属。");
                break;
            }
        }
        if (next === scope) break;
        scope = next;
    }
    // Koishi loader supplies stable plugin keys. Without a loader, fail closed to a
    // unique namespace instead of mixing independently created plugin instances.
    const namespace = keys.length ? keys.reverse().join("/") : `unmanaged-${randomUUID()}`;
    if (!keys.length) warnUsage(owner, "未找到持久化插件标识，用量统计使用独立临时标识，重启后不会自动恢复。");
    const digest = createHash("sha256").update(namespace).digest("hex").slice(0, 24);
    ledger = new UsageLedger(
        path.join(owner.baseDir, "data", "yesimbot", "usage", `${digest}.json`),
        (message) => warnUsage(owner, message),
        () => clearContextSnapshots(ctx, usageOwner),
    );
    ledgers.set(identity, ledger);
    owner.on?.("dispose", () => ledger!.close());
    return ledger;
}

/** Observe each transport call, so SDK tool steps and retries each have a record. */
export function observeUsageFetch(ctx: Context, metadata: UsageMetadata, fetch: typeof globalThis.fetch, explicitOwner?: UsageOwner): typeof globalThis.fetch {
    return (async (url, init) => {
        let ledger: UsageLedger, ticket: UsageTicket;
        try {
            ledger = getUsageLedger(ctx, explicitOwner);
            await ledger.ready();
            ticket = ledger.begin(metadata);
        } catch (error) {
            warnUsage(ctx, `用量统计不可用，继续原始模型请求: ${error.message}`);
            return fetch(url, init);
        }
        let payload: any;
        const oversized = typeof init?.body === "string" && Buffer.byteLength(init.body, "utf8") > MAX_CONTEXT_SNAPSHOT_BYTES;
        try {
            payload = !oversized && typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        } catch {
            /* non-JSON request */
        }
        try {
            captureContextSnapshot(
                ctx,
                ticket,
                payload,
                ticket.period,
                oversized ? "请求上下文超过单条快照容量，未解析或保留正文；本地输入估算不可用" : undefined,
                explicitOwner,
            );
        } catch (error) {
            warnUsage(ctx, `请求上下文快照不可用: ${error.message}`);
        }
        const input = payload?.messages
            ? {
                  messages: payload.messages,
                  tools: payload.tools,
                  response_format: payload.response_format,
                  tool_choice: payload.tool_choice,
              }
            : (payload?.input ?? (payload?.state !== undefined ? { state: payload.state, questions: payload.questions } : undefined));
        let api: any, output: any;
        let finalized = false;
        const complete = (status: string) => {
            if (finalized) return;
            finalized = true;
            // No prompts or response bodies are retained in the persistent ledger.
            try {
                void ledger.finish(ticket, { api, input, output, status }).catch((error) => warnUsage(ctx, error.message));
            } catch (error) {
                warnUsage(ctx, error.message);
            }
        };
        try {
            const response = await fetch(url, init);
            if (!response.ok) {
                try {
                    const data = await response.clone().json();
                    api = data.usage;
                } catch {
                    /* failure without usage */
                }
                complete(`http-${response.status}`);
                return response;
            }
            if (!response.body) {
                complete(response.ok ? "success" : `http-${response.status}`);
                return response;
            }
            const streaming = payload?.stream === true || response.headers.get("content-type")?.includes("text/event-stream");
            let buffer = "",
                text = "",
                overflow = false;
            const decoder = new TextDecoder();
            const consume = (frame: string) => {
                for (const line of frame.split(/\r?\n/)) {
                    if (!line.startsWith("data:")) continue;
                    try {
                        const data = JSON.parse(line.slice(5).trim());
                        if (data.usage) api = { ...api, ...data.usage };
                        if (data.message?.usage) api = { ...api, ...data.message.usage };
                        for (const choice of data.choices ?? []) {
                            const delta = choice.delta;
                            if (!overflow && typeof delta?.content === "string") text += delta.content;
                            for (const call of overflow ? [] : (delta?.tool_calls ?? []))
                                text += (call.function?.name ?? "") + (call.function?.arguments ?? "");
                        }
                        if (!overflow && typeof data.delta?.text === "string") text += data.delta.text;
                        if (text.length > 2_000_000) {
                            overflow = true;
                            text = "";
                        }
                    } catch {
                        /* done marker / invalid frame */
                    }
                }
            };
            const reader = response.body.getReader();
            const body = new ReadableStream<Uint8Array>({
                async pull(controller) {
                    try {
                        const { done, value } = await reader.read();
                        if (done) {
                            buffer += decoder.decode();
                            if (streaming) {
                                if (buffer) consume(buffer);
                                output = overflow ? undefined : text;
                            } else if (!overflow) {
                                try {
                                    const data = JSON.parse(buffer);
                                    api = data.usage;
                                    output = data.choices?.map((choice: any) => choice.message ?? choice.text) ?? data.answers ?? data.content;
                                    if (Array.isArray(data.data) && data.data.some((item: any) => Array.isArray(item.embedding))) output = "";
                                } catch {
                                    /* malformed response still gets a record */
                                }
                            }
                            complete(response.ok ? "success" : `http-${response.status}`);
                            controller.close();
                            return;
                        }
                        buffer += decoder.decode(value, { stream: true });
                        if (streaming) {
                            const frames = buffer.split(/\r?\n\r?\n/);
                            buffer = frames.pop()!;
                            for (const frame of frames) consume(frame);
                        }
                        if (buffer.length > 2_000_000) {
                            overflow = true;
                            buffer = "";
                        }
                        controller.enqueue(value);
                    } catch (error) {
                        output = streaming && !overflow ? text : undefined;
                        complete("stream-error");
                        controller.error(error);
                    }
                },
                async cancel(reason) {
                    output = streaming && !overflow ? text : undefined;
                    complete("cancelled");
                    await reader.cancel(reason);
                },
            });
            return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        } catch (error) {
            complete("request-error");
            throw error;
        }
    }) as typeof globalThis.fetch;
}
