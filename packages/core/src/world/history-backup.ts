import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { Context } from "koishi";

import { TableName } from "../shared/constants";
import { getInstanceDirectory, getInstanceScope } from "../shared/instance-scope";
import { HISTORY_CHANNELS } from "./channel-metadata";
import type { InteractionManager } from "./interaction-manager";
import type { SemanticMemoryManager } from "./l2-semantic-memory";
import type { HistoryChannelType } from "./types";

export const BACKUP_MAX_BYTES = 8 * 1024 * 1024;
export const BACKUP_MAX_ROWS = 5000;
const tables = { messages: TableName.Messages, events: TableName.SystemEvents, l2: TableName.L2Chunks, l3: TableName.L3Diaries } as const;
type Kind = keyof typeof tables;
type Row = Record<string, any>;
export interface BackupTarget {
    platform: string;
    channelId: string;
    selfId: string;
    channelType?: HistoryChannelType;
}
export interface ScopeBackup {
    format: "yesimbot.scope-backup";
    version: 1;
    createdAt: string;
    scope: BackupTarget & { instance: string };
    /** The exporter owns this package, not the shared database rows. */
    databaseScope: "shared-platform-channel";
    records: Record<Kind, Row[]>;
    agentLogs: { records: Row[]; unknown: number; malformed: number; restore: "unsupported" };
    sha256: string;
}
const counts = () => ({ messages: 0, events: 0, l2: 0, l3: 0 });

/** Stable JSON covers the manifest and every record, independent of key order. */
function canonical(value: any, depth = 0): string {
    if (depth > 24) throw new Error("备份数据嵌套过深");
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`)
            .join(",")}}`;
    throw new Error("备份包含无效 JSON 数据");
}
/** Walk database values before serializing them; no large row/string is copied first. */
function consumeBudget(value: any, budget: { remaining: number }, depth = 0): void {
    const consume = (bytes: number) => {
        budget.remaining -= bytes;
        if (budget.remaining < 0) throw new Error("备份大小超过上限");
    };
    if (depth > 24) throw new Error("备份数据嵌套过深");
    if (value instanceof Date) {
        consume(26);
        return;
    }
    if (typeof value === "string") {
        if (Buffer.byteLength(value) > budget.remaining) throw new Error("备份大小超过上限");
        consume(Buffer.byteLength(JSON.stringify(value)));
    } else if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) consume(JSON.stringify(value).length);
    else if (Array.isArray(value)) {
        consume(2);
        for (const item of value) {
            consumeBudget(item, budget, depth + 1);
            consume(1);
        }
    } else if (value && typeof value === "object") {
        consume(2);
        for (const key in value)
            if (Object.hasOwn(value, key) && value[key] !== undefined) {
                consumeBudget(key, budget, depth + 1);
                consume(2);
                consumeBudget(value[key], budget, depth + 1);
            }
    } else if (value !== undefined) throw new Error("备份包含无效 JSON 数据");
}
export function backupDigest(value: object): string {
    const { sha256: _sha256, ...payload } = value as ScopeBackup;
    return createHash("sha256").update(canonical(payload)).digest("hex");
}
function object(value: unknown): value is Row {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, label: string, allowEmpty = false): string {
    if (typeof value !== "string" || (!allowEmpty && !value) || value.length > BACKUP_MAX_BYTES) throw new Error(`备份字段无效：${label}`);
    return value;
}
function identifier(value: unknown, label: string): string {
    const result = text(value, label);
    if (result.length > 512 || Array.from(result).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
        throw new Error(`备份标识无效：${label}`);
    return result;
}
function date(value: unknown): string {
    if (!(value instanceof Date) && typeof value !== "string") throw new Error("备份日期无效");
    const result = new Date(value);
    if (!Number.isFinite(result.getTime())) throw new Error("备份日期无效");
    const iso = result.toISOString();
    if (typeof value === "string" && iso !== value) throw new Error("备份日期须为 ISO 时间");
    return iso;
}
function strings(value: unknown): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("备份字符串列表无效");
    return value.slice();
}
function exactKeys(value: Row, keys: string[]) {
    if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error("备份包含未知字段");
}
function validTarget(target: BackupTarget) {
    for (const key of ["platform", "channelId", "selfId"] as const) identifier(target[key], key);
    if (target.channelType !== undefined && target.channelType !== "private" && target.channelType !== "guild") throw new Error("备份频道类型无效");
    if (target.platform === "." || target.platform === "..") throw new Error("备份平台无效");
}
function ownEvent(row: Row, target: BackupTarget) {
    return (!row.eventScope || row.eventScope === "channel") && (!row.botKey || row.botKey === JSON.stringify([target.platform, target.selfId]));
}
const fields: Record<Kind, string[]> = {
    messages: ["id", "platform", "channelId", "channelType", "sender", "timestamp", "content", "quoteId"],
    events: ["id", "platform", "channelId", "channelType", "type", "timestamp", "eventScope", "botKey", "payload", "message"],
    l2: ["id", "platform", "channelId", "content", "embedding", "participantIds", "startTimestamp", "endTimestamp"],
    l3: ["id", "platform", "channelId", "content", "date", "generatedAt", "sourceMessageCount", "keywords", "mentionedUserIds"],
};
function normalizeRow(kind: Kind, row: Row, target: BackupTarget, importing = false): Row {
    if (!object(row)) throw new Error("备份记录无效");
    if (importing) exactKeys(row, fields[kind]);
    if (row.platform !== target.platform || row.channelId !== target.channelId) throw new Error("备份记录超出范围");
    const result: Row = { id: identifier(row.id, "id"), platform: target.platform, channelId: target.channelId };
    if (kind === "messages" || kind === "events") {
        result.timestamp = date(row.timestamp);
        if (row.channelType) {
            if (row.channelType !== "private" && row.channelType !== "guild") throw new Error("备份频道类型无效");
            if (target.channelType && row.channelType !== target.channelType) throw new Error("备份频道类型归属不一致");
            result.channelType = row.channelType;
        }
    }
    if (kind !== "events") result.content = text(row.content, "content", true);
    if (kind === "messages") {
        if (!object(row.sender)) throw new Error("备份发送者无效");
        if (importing) exactKeys(row.sender, ["id", "name", "roles"]);
        result.sender = { id: identifier(row.sender.id, "sender.id") };
        if (row.sender.name) result.sender.name = text(row.sender.name, "sender.name");
        if (row.sender.roles?.length) result.sender.roles = strings(row.sender.roles);
        if (row.quoteId) result.quoteId = identifier(row.quoteId, "quoteId");
    } else if (kind === "events") {
        if (!ownEvent(row, target)) throw new Error("备份事件超出当前机器人频道范围");
        result.eventScope = "channel";
        if (row.botKey) result.botKey = row.botKey;
        result.type = identifier(row.type, "event.type");
        if (!object(row.payload)) throw new Error("备份事件载荷无效");
        canonical(row.payload);
        result.payload = row.payload;
        if (row.message) result.message = text(row.message, "event.message");
    } else if (kind === "l2") {
        if (!Array.isArray(row.embedding) || row.embedding.some((item: unknown) => typeof item !== "number" || !Number.isFinite(item)))
            throw new Error("备份向量无效");
        result.embedding = row.embedding.slice();
        result.participantIds = strings(row.participantIds);
        result.startTimestamp = date(row.startTimestamp);
        result.endTimestamp = date(row.endTimestamp);
        if (result.startTimestamp > result.endTimestamp) throw new Error("备份记忆日期顺序无效");
    } else {
        const day = text(row.date, "diary.date");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) !== day) throw new Error("备份日记日期无效");
        result.date = day;
        result.keywords = strings(row.keywords);
        result.mentionedUserIds = strings(row.mentionedUserIds);
        if (row.generatedAt) result.generatedAt = date(row.generatedAt);
        if (row.sourceMessageCount !== undefined) {
            if (!Number.isSafeInteger(row.sourceMessageCount) || row.sourceMessageCount < 0) throw new Error("备份来源计数无效");
            result.sourceMessageCount = row.sourceMessageCount;
        }
    }
    return result;
}
function databaseRow(kind: Kind, value: Row) {
    const result = { ...value };
    for (const key of kind === "l2" ? ["startTimestamp", "endTimestamp"] : kind === "l3" ? ["generatedAt"] : ["timestamp"]) {
        if (result[key]) result[key] = new Date(result[key]);
    }
    return result;
}

export class HistoryBackupManager {
    private readonly instance: string;
    private readonly directory: string;
    constructor(
        private ctx: Context,
        private world: { l1_manager: InteractionManager; l2_manager: SemanticMemoryManager },
    ) {
        this.instance = getInstanceScope(ctx);
        this.directory = getInstanceDirectory(ctx, "data/yesimbot/backups");
    }
    private generation(target: BackupTarget) {
        return this.world.l2_manager.getHistoryGeneration(target);
    }
    private checkGeneration(target: BackupTarget, generation: number) {
        if (this.generation(target) !== generation) throw new Error("备份读取期间历史已改变，请重新导出");
    }
    public async export(target: BackupTarget): Promise<ScopeBackup> {
        validTarget(target);
        const generation = this.generation(target);
        return this.world.l2_manager.withHistoryBarrier(target, () =>
            this.world.l1_manager.withAgentHistorySnapshot(target, BACKUP_MAX_BYTES, async (agentLogs) => {
                const [channel] = await this.ctx.database.get(HISTORY_CHANNELS, { platform: target.platform, channelId: target.channelId });
                let channelType =
                    target.channelType ?? (channel?.channelType === "private" || channel?.channelType === "guild" ? channel.channelType : undefined);
                const selected = { ...target, channelType };
                const records = { messages: [], events: [], l2: [], l3: [] } as ScopeBackup["records"];
                // Reserve the small manifest and collection delimiters before reading any facts.
                const budget = { remaining: BACKUP_MAX_BYTES - 4096 };
                consumeBudget(agentLogs, budget);
                let count = agentLogs.records.length;
                let scanned = 0;
                for (const kind of Object.keys(tables) as Kind[]) {
                    for (let offset = 0; ; offset++) {
                        this.checkGeneration(target, generation);
                        const rows = (await this.ctx.database.get(tables[kind] as any, { platform: target.platform, channelId: target.channelId }, {
                            offset,
                            limit: 1,
                            sort: { id: "asc" },
                        } as any)) as Row[];
                        this.checkGeneration(target, generation);
                        if (!rows.length) break;
                        if (rows.length !== 1) throw new Error("数据库未遵守备份分页上限");
                        if (++scanned > BACKUP_MAX_ROWS) throw new Error("备份扫描条数超过上限");
                        const row = rows[0];
                        if (kind === "events" && !ownEvent(row, target)) continue;
                        if (++count > BACKUP_MAX_ROWS) throw new Error("备份条数超过上限");
                        consumeBudget(row, { remaining: budget.remaining });
                        const normalized = normalizeRow(kind, row, selected);
                        consumeBudget(normalized, budget);
                        records[kind].push(normalized);
                    }
                }
                const observedTypes = new Set([...records.messages, ...records.events].map((row) => row.channelType).filter(Boolean));
                if (observedTypes.size > 1) throw new Error("备份频道类型归属冲突，无法确定群聊或私聊");
                channelType ??= observedTypes.values().next().value as HistoryChannelType | undefined;
                const backup: ScopeBackup = {
                    format: "yesimbot.scope-backup",
                    version: 1,
                    createdAt: new Date().toISOString(),
                    scope: {
                        platform: target.platform,
                        channelId: target.channelId,
                        selfId: target.selfId,
                        instance: this.instance,
                        ...(channelType ? { channelType } : {}),
                    },
                    databaseScope: "shared-platform-channel",
                    records,
                    agentLogs: { ...agentLogs, restore: "unsupported" },
                    sha256: "",
                };
                this.assertRowCount(backup);
                backup.sha256 = backupDigest(backup);
                if (Buffer.byteLength(JSON.stringify(backup)) > BACKUP_MAX_BYTES) throw new Error("备份大小超过上限");
                this.checkGeneration(target, generation);
                return backup;
            }),
        );
    }
    private assertRowCount(backup: ScopeBackup) {
        const total = backup.agentLogs.records.length + Object.values(backup.records).reduce((sum, rows) => sum + rows.length, 0);
        if (total > BACKUP_MAX_ROWS) throw new Error("备份条数超过上限");
    }
    private parse(target: BackupTarget, input: string): ScopeBackup {
        validTarget(target);
        if (typeof input !== "string" || Buffer.byteLength(input) > BACKUP_MAX_BYTES) throw new Error("备份大小超过上限");
        const backup = JSON.parse(input) as ScopeBackup;
        if (!object(backup) || backup.format !== "yesimbot.scope-backup" || backup.version !== 1) throw new Error("不支持的备份版本");
        exactKeys(backup, ["format", "version", "createdAt", "scope", "databaseScope", "records", "agentLogs", "sha256"]);
        if (
            backup.databaseScope !== "shared-platform-channel" ||
            !object(backup.scope) ||
            backup.scope.instance !== this.instance ||
            ["platform", "channelId", "selfId"].some((key) => backup.scope[key as keyof BackupTarget] !== target[key as keyof BackupTarget])
        )
            throw new Error("备份归属与当前实例、平台、频道或机器人不一致");
        exactKeys(backup.scope, ["instance", "platform", "channelId", "selfId", "channelType"]);
        validTarget(backup.scope);
        if (target.channelType && backup.scope.channelType && target.channelType !== backup.scope.channelType) throw new Error("备份频道类型归属不一致");
        date(backup.createdAt);
        if (typeof backup.sha256 !== "string" || backup.sha256 !== backupDigest(backup)) throw new Error("备份完整性校验失败");
        if (target.channelType) backup.scope.channelType = target.channelType;
        if (!object(backup.records) || !object(backup.agentLogs) || !Array.isArray(backup.agentLogs.records) || backup.agentLogs.restore !== "unsupported")
            throw new Error("备份记录结构无效");
        exactKeys(backup.records, Object.keys(tables));
        exactKeys(backup.agentLogs, ["records", "unknown", "malformed", "restore"]);
        for (const counter of [backup.agentLogs.unknown, backup.agentLogs.malformed])
            if (!Number.isSafeInteger(counter) || counter < 0) throw new Error("备份日志计数无效");
        for (const kind of Object.keys(tables) as Kind[]) if (!Array.isArray(backup.records[kind])) throw new Error("备份记录结构无效");
        this.assertRowCount(backup);
        for (const kind of Object.keys(tables) as Kind[]) {
            const seen = new Set<string>();
            backup.records[kind] = backup.records[kind].map((row) => {
                const normalized = normalizeRow(kind, row, { ...target, channelType: target.channelType ?? backup.scope.channelType }, true);
                if (seen.has(normalized.id)) throw new Error("备份包含重复记录");
                seen.add(normalized.id);
                return normalized;
            });
        }
        for (const row of backup.agentLogs.records) {
            if (!object(row) || row.platform !== target.platform || row.channelId !== target.channelId) throw new Error("备份日志超出范围");
            identifier(row.id, "log.id");
            date(row.timestamp);
            if (!["agent_thought", "agent_action", "agent_observation", "agent_heartbeat"].includes(row.type)) throw new Error("备份日志类型无效");
        }
        return backup;
    }
    private async inspect(backup: ScopeBackup) {
        const missing = counts(),
            identical = counts(),
            conflicts: Array<{ kind: Kind | "channelMetadata"; id: string }> = [];
        const [channel] = await this.ctx.database.get(HISTORY_CHANNELS, { platform: backup.scope.platform, channelId: backup.scope.channelId });
        const channelType =
            backup.scope.channelType ?? (channel?.channelType === "private" || channel?.channelType === "guild" ? channel.channelType : undefined);
        const metadata = {
            channelType,
            missing: !channel?.channelType,
            reason: !channelType
                ? "频道类型归属不明：缺少可验证的群聊或私聊信息，已拒绝恢复；不会自动猜测。"
                : channel?.channelType && channel.channelType !== channelType
                  ? "当前频道类型与备份不一致，已拒绝恢复。"
                  : undefined,
        };
        if (!channelType || (channel?.channelType && channel.channelType !== channelType))
            conflicts.push({ kind: "channelMetadata", id: backup.scope.channelId });
        const pending: Array<{ kind: Kind; row: Row }> = [];
        for (const kind of Object.keys(tables) as Kind[])
            for (const row of backup.records[kind]) {
                // L2/L3/events have globally unique IDs: never hide an out-of-scope collision.
                const query = kind === "messages" ? { id: row.id, platform: row.platform, channelId: row.channelId } : { id: row.id };
                const existing = (await this.ctx.database.get(tables[kind] as any, query as any)) as Row[];
                if (!existing.length) {
                    missing[kind]++;
                    pending.push({ kind, row });
                    continue;
                }
                let same = false;
                try {
                    same = existing.length === 1 && canonical(normalizeRow(kind, existing[0], backup.scope)) === canonical(row);
                } catch {
                    /* Invalid or foreign rows are conflicts. */
                }
                if (same) identical[kind]++;
                else conflicts.push({ kind, id: row.id });
            }
        return {
            status: conflicts.length ? ("conflict" as const) : ("ready" as const),
            missing,
            identical,
            conflicts,
            agentLogs: { exported: backup.agentLogs.records.length, restored: 0, restore: "unsupported" as const },
            metadata,
            pending,
        };
    }
    public async preflight(target: BackupTarget, input: string) {
        const backup = this.parse(target, input);
        return this.world.l2_manager.withHistoryBarrier(target, async () => {
            const { pending: _pending, ...report } = await this.inspect(backup);
            return report;
        });
    }
    public async restore(target: BackupTarget, input: string) {
        const backup = this.parse(target, input);
        const initial = await this.preflight(target, input);
        if (initial.status === "conflict") return { ...initial, inserted: counts(), partialEffects: false };
        if (!initial.metadata.missing && Object.values(initial.missing).every((count) => count === 0))
            return { ...initial, status: "restored" as const, inserted: counts(), partialEffects: false };
        // This only invalidates in-flight generations and buffers; no history is deleted.
        return this.world.l2_manager.clearHistory(target, async () => {
            const { pending, ...report } = await this.inspect(backup);
            const inserted = counts();
            if (report.status === "conflict") return { ...report, inserted, partialEffects: false };
            if (report.metadata.missing) {
                try {
                    await this.ctx.database.upsert(HISTORY_CHANNELS, [
                        { platform: target.platform, channelId: target.channelId, channelType: report.metadata.channelType! },
                    ]);
                    this.world.l2_manager.observeChannel(target, report.metadata.channelType!);
                } catch {
                    return {
                        ...report,
                        status: "partial" as const,
                        inserted,
                        partialEffects: true,
                        failed: { kind: "channelMetadata", id: target.channelId },
                        message: "频道元信息恢复中断，可能已有部分效果；请预检后重试。",
                    };
                }
            }
            for (const { kind, row } of pending) {
                try {
                    await this.ctx.database.create(tables[kind] as any, databaseRow(kind, row) as any);
                    inserted[kind]++;
                } catch {
                    // A driver may commit and then fail its response. Do not claim rollback or zero effects.
                    return {
                        ...report,
                        status: "partial" as const,
                        inserted,
                        partialEffects: true,
                        failed: { kind, id: row.id },
                        message: "恢复中断，可能已有部分记录写入；请预检后重试。",
                    };
                }
            }
            return { ...report, status: "restored" as const, inserted, partialEffects: false };
        });
    }
    public async save(target: BackupTarget) {
        const generation = this.generation(target);
        const backup = await this.export(target);
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
        const id = randomUUID(),
            filePath = path.join(this.directory, `${id}.json`),
            temporary = `${filePath}.tmp`;
        try {
            const handle = await fs.open(temporary, "wx", 0o600);
            try {
                await handle.writeFile(JSON.stringify(backup));
                await handle.sync();
            } finally {
                await handle.close();
            }
            this.checkGeneration(target, generation);
            await fs.rename(temporary, filePath);
            try {
                this.checkGeneration(target, generation);
            } catch (error) {
                await fs.rm(filePath, { force: true });
                throw error;
            }
        } finally {
            await fs.rm(temporary, { force: true });
        }
        return {
            id,
            filePath,
            counts: Object.fromEntries(Object.entries(backup.records).map(([kind, rows]) => [kind, rows.length])),
            agentLogs: backup.agentLogs.records.length,
        };
    }
    public async load(id: string): Promise<string> {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error("备份编号无效");
        const handle = await fs.open(path.join(this.directory, `${id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > BACKUP_MAX_BYTES) throw new Error("备份大小或文件类型无效");
            const buffer = Buffer.alloc(BACKUP_MAX_BYTES + 1);
            let offset = 0;
            while (offset < buffer.length) {
                const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
                if (!bytesRead) break;
                offset += bytesRead;
            }
            if (offset > BACKUP_MAX_BYTES) throw new Error("备份大小超过上限");
            return buffer.subarray(0, offset).toString("utf8");
        } finally {
            await handle.close();
        }
    }
}
