import { createHash } from "node:crypto";

import type { Context } from "koishi";

import { TableName } from "../shared/constants";
import { historyCoordinator } from "./history-coordinator";
import type { SemanticMemoryManager, SemanticMemoryScope } from "./l2-semantic-memory";
import type { MessageWindowTarget } from "./message-window";
import type { MessageData } from "./types";

const CONVERSATION_STATE = "worldstate.conversation_state";

export interface FollowUpState {
    userIds: string[];
    expiresAt: number;
}

export interface ConversationStateInput {
    followUp?: { userIds: string[]; durationSeconds: number };
    topic?: string;
    openIssues?: string[];
    sourceMessageIds: string[];
    expectedRevision: number;
}

export interface ConversationState {
    followUp?: FollowUpState;
    revision: number;
    topic: string;
    openIssues: string[];
    sourceMessageIds: string[];
    createdAt: string;
    updatedAt: string;
}

export interface ConversationStateResult {
    state?: ConversationState;
    unknown: boolean;
    sourceMessages?: MessageData[];
}

interface StatePayload extends ConversationState {
    scope: string;
    sourceFingerprints: string[];
    sourceOldestAt?: string;
}

interface StateRow {
    id: string;
    owner: string;
    platform: string;
    selfId: string;
    channelId: string;
    channelType: string;
    retentionTimestamp: Date;
    schemaVersion: number;
    payload: StatePayload;
}

declare module "koishi" {
    interface Tables {
        [CONVERSATION_STATE]: StateRow;
    }
}

export function registerConversationStateModel(ctx: Context): void {
    ctx.model.extend(
        CONVERSATION_STATE,
        {
            id: "string(64)",
            owner: "string(64)",
            platform: "string(255)",
            selfId: "string(255)",
            channelId: "string(255)",
            channelType: "string(16)",
            retentionTimestamp: "timestamp",
            // Existing payload-only rows get 0; only validated, stably owned writes use 1.
            schemaVersion: { type: "unsigned", initial: 0 },
            payload: "json",
        },
        { primary: "id" },
    );
}

/** Call under the history barrier, after earlier reads/writes have drained. */
export async function clearConversationStates(database: Context["database"], scope: SemanticMemoryScope) {
    // Standalone semantic-memory users may not register the optional working-state model.
    if (!database?.tables?.[CONVERSATION_STATE]) return;
    const query = "type" in scope ? (scope.type === "all" ? {} : { channelType: scope.type }) : { platform: scope.platform, channelId: scope.channelId };
    // Old rows cannot prove stable ownership and are never adopted. Their embedded
    // routing scope is sufficient for targeted deletion; global retention removes
    // all remaining legacy rows, including malformed/unscopable payloads.
    const legacy = await database.get(CONVERSATION_STATE, { schemaVersion: 0 });
    const legacyIds = legacy
        .filter(({ payload }) => {
            if ("type" in scope && scope.type === "all") return true;
            try {
                const stored = JSON.parse(payload.scope);
                if (!Array.isArray(stored) || stored.length !== 5) return false;
                return "type" in scope ? stored[4] === scope.type : stored[1] === scope.platform && stored[3] === scope.channelId;
            } catch {
                return false;
            }
        })
        .map(({ id }) => id);
    await database.remove(CONVERSATION_STATE, legacyIds.length ? { $or: [query, { id: { $in: legacyIds } }] } : query);
}

/** Retention follows the oldest source, or updatedAt for an explicitly empty state. */
export async function pruneConversationStates(database: Context["database"], cutoff: Date) {
    if (!database?.tables?.[CONVERSATION_STATE]) return;
    await database.remove(CONVERSATION_STATE, { $or: [{ retentionTimestamp: { $lt: cutoff } }, { schemaVersion: 0 }] });
}

// Cordis proxies for the same physical DB share a coordinator and mutex ownership.
const queues = new WeakMap<object, Map<string, Promise<unknown>>>();
const invalidations = new WeakMap<object, Set<string>>();
class SourceUnavailableError extends Error {}
function serialize<T>(database: object, id: string, operation: () => Promise<T>): Promise<T> {
    const owner = historyCoordinator(database);
    let queue = queues.get(owner);
    if (!queue) queues.set(owner, (queue = new Map()));
    const previous = queue.get(id) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(operation);
    queue.set(id, task);
    void task
        .finally(() => {
            if (queue!.get(id) === task) queue!.delete(id);
        })
        .catch(() => {});
    return task;
}

function fingerprint(record: MessageData): string {
    return createHash("sha256")
        .update(
            JSON.stringify([
                record.platform,
                record.channelId,
                record.channelType,
                record.id,
                new Date(record.timestamp).toISOString(),
                record.sender,
                record.content,
                record.quoteId ?? null,
            ]),
        )
        .digest("hex");
}

function validateRecipients(ids: string[]) {
    if (
        !Array.isArray(ids) ||
        ids.length < 1 ||
        ids.length > 10 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => typeof id !== "string" || !id.trim() || id.length > 255 || /\p{Cc}/u.test(id))
    )
        throw new Error("等待用户须为 1–10 个不同的用户 ID");
}

function validateInput(input: ConversationStateInput) {
    if (!input || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error("工作会话状态 expectedRevision 须为非负整数");
    const topic = input.topic ?? "",
        openIssues = input.openIssues ?? [];
    if (typeof topic !== "string" || topic.length > 1000) throw new Error("工作话题须为最多 1000 字的文本");
    if (!Array.isArray(openIssues) || openIssues.length > 10 || openIssues.some((s) => typeof s !== "string" || !s.trim() || s.length > 500))
        throw new Error("未决问题须为最多 10 条、每条 1–500 字");
    const ids = input.sourceMessageIds;
    if (!Array.isArray(ids) || ids.length > 10 || ids.some((id) => typeof id !== "string" || !id.trim() || id.length > 255) || new Set(ids).size !== ids.length)
        throw new Error("来源消息 ID 须为最多 10 个不同的原始 ID");
    if ((topic.trim() || openIssues.length || input.followUp) && !ids.length) throw new Error("非空工作状态需要 1–10 个已验证来源消息 ID");
    let followUp: FollowUpState | undefined;
    if (input.followUp !== undefined) {
        const { userIds, durationSeconds } = input.followUp;
        validateRecipients(userIds);
        if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 86400) throw new Error("等待时长须为 1–86400 秒");
        followUp = { userIds: [...userIds], expiresAt: Date.now() + durationSeconds * 1000 };
    }
    return { topic, openIssues: [...openIssues], sourceMessageIds: [...ids], ...(followUp ? { followUp } : {}) };
}

/** Explicit working notes, not inferred facts. World service supplies barrier and live authorization. */
export class ConversationStateManager {
    private readonly watchers = new Map<string, () => void>();
    private readonly invalidated: Set<string>;

    constructor(
        private ctx: Context,
        private history: SemanticMemoryManager,
        private reportError: (error: unknown) => void = () => {},
    ) {
        const owner = historyCoordinator(ctx.database);
        let invalidated = invalidations.get(owner);
        if (!invalidated) invalidations.set(owner, (invalidated = new Set()));
        this.invalidated = invalidated;
    }

    public dispose() {
        for (const stop of this.watchers.values()) stop();
        this.watchers.clear();
    }

    private key(target: MessageWindowTarget, instance: string) {
        const scope = JSON.stringify([instance, target.platform, target.selfId, target.channelId, target.channelType]);
        const id = createHash("sha256").update(scope).digest("hex");
        if (!this.watchers.has(id)) {
            this.watchers.set(
                id,
                this.history.watchHistory(target, () => {
                    this.invalidated.add(id);
                    // Registered synchronously at clear start. New reads/updates queue behind deletion.
                    void serialize(this.ctx.database, id, () => this.ctx.database.remove(CONVERSATION_STATE, { id })).catch(this.reportError);
                }),
            );
        }
        return { scope, id };
    }

    private async sourceFingerprints(target: MessageWindowTarget, ids: string[]) {
        if (!ids.length) return { fingerprints: [], sourceOldestAt: undefined, records: [] as MessageData[] };
        const scope = { platform: target.platform, channelId: target.channelId, channelType: target.channelType };
        const rows = await this.ctx.database.get(TableName.Messages, { ...scope, id: { $in: ids } });
        if (
            rows.length !== ids.length ||
            rows.some((r) => r.platform !== target.platform || r.channelId !== target.channelId || r.channelType !== target.channelType)
        )
            throw new SourceUnavailableError("工作状态的原始来源不存在或不属于当前会话");
        const fingerprints = ids.map((id) => {
            const matching = rows.filter((r) => r.id === id);
            if (matching.length !== 1) throw new SourceUnavailableError("工作状态的原始来源不唯一");
            return fingerprint(matching[0]);
        });
        return { fingerprints, records: rows, sourceOldestAt: new Date(Math.min(...rows.map((row) => new Date(row.timestamp).getTime()))).toISOString() };
    }

    private async readPayload(id: string, scope: string, target: MessageWindowTarget, assertCurrent: () => void): Promise<StatePayload | undefined> {
        const [row] = await this.ctx.database.get(CONVERSATION_STATE, { id });
        assertCurrent();
        if (!row) return undefined;
        const state = row.payload;
        let valid =
            row.schemaVersion === 1 &&
            row.owner === JSON.parse(scope)[0] &&
            row.platform === target.platform &&
            row.selfId === target.selfId &&
            row.channelId === target.channelId &&
            row.channelType === target.channelType &&
            !this.invalidated.has(id) &&
            state?.scope === scope &&
            Number.isSafeInteger(state.revision) &&
            state.revision > 0;
        valid = valid && Number.isFinite(Date.parse(state.createdAt)) && Number.isFinite(Date.parse(state.updatedAt)) && state.createdAt <= state.updatedAt;
        if (valid) {
            try {
                validateInput({ ...state, followUp: undefined, expectedRevision: state.revision });
                if (state.followUp !== undefined) {
                    validateRecipients(state.followUp.userIds);
                    if (
                        !state.sourceMessageIds.length ||
                        !Number.isFinite(state.followUp.expiresAt) ||
                        state.followUp.expiresAt <= Date.parse(state.updatedAt) ||
                        state.followUp.expiresAt > Date.parse(state.updatedAt) + 86400_000
                    )
                        throw new Error("等待状态无效");
                }
            } catch {
                valid = false;
            }
        }
        if (valid) {
            try {
                const { fingerprints } = await this.sourceFingerprints(target, state.sourceMessageIds);
                valid = JSON.stringify(fingerprints) === JSON.stringify(state.sourceFingerprints);
            } catch (error) {
                if (!(error instanceof SourceUnavailableError)) throw error;
                valid = false;
            }
        }
        assertCurrent();
        if (!valid) {
            await this.ctx.database.remove(CONVERSATION_STATE, { id });
            assertCurrent();
            return undefined;
        }
        return state;
    }

    private result(payload?: StatePayload, maxFollowUpDurationSeconds = 86400): ConversationStateResult {
        if (!payload) return { unknown: true };
        const { scope: _scope, sourceFingerprints: _fingerprints, sourceOldestAt: _sourceOldestAt, ...state } = payload;
        if (state.followUp) {
            const expiresAt = Math.min(state.followUp.expiresAt, Date.parse(state.updatedAt) + maxFollowUpDurationSeconds * 1000);
            if (Date.now() >= expiresAt) delete state.followUp;
            else state.followUp = { userIds: [...state.followUp.userIds], expiresAt };
        }
        return { state, unknown: !state.topic.trim() && !state.openIssues.length && !state.followUp };
    }

    public read(target: MessageWindowTarget, instance: string, assertCurrent: () => void, includeSources = false, maxFollowUpDurationSeconds = 86400) {
        const { id, scope } = this.key(target, instance);
        return serialize(this.ctx.database, id, async () => {
            assertCurrent();
            const payload = await this.readPayload(id, scope, target, assertCurrent);
            if (!payload || !includeSources) return this.result(payload, maxFollowUpDurationSeconds);
            try {
                const sources = await this.sourceFingerprints(target, payload.sourceMessageIds);
                assertCurrent();
                if (JSON.stringify(sources.fingerprints) !== JSON.stringify(payload.sourceFingerprints)) return { unknown: true };
                return { ...this.result(payload, maxFollowUpDurationSeconds), sourceMessages: sources.records };
            } catch (error) {
                assertCurrent();
                if (error instanceof SourceUnavailableError) return { unknown: true };
                throw error;
            }
        });
    }

    public update(target: MessageWindowTarget, instance: string, input: ConversationStateInput, assertCurrent: () => void) {
        // Snapshot caller-owned arrays before any await; a changed input cannot bypass validation.
        const fields = validateInput(input),
            expectedRevision = input.expectedRevision,
            durationSeconds = input.followUp?.durationSeconds;
        const { id, scope } = this.key(target, instance);
        return serialize(this.ctx.database, id, async () => {
            assertCurrent();
            const current = await this.readPayload(id, scope, target, assertCurrent);
            if ((current?.revision ?? 0) !== expectedRevision) throw new Error("工作会话状态 revision 版本已改变，请重新读取");
            const { fingerprints: sourceFingerprints, sourceOldestAt } = await this.sourceFingerprints(target, fields.sourceMessageIds);
            assertCurrent();
            const now = new Date().toISOString();
            const payload: StatePayload = {
                ...fields,
                ...(fields.followUp ? { followUp: { userIds: fields.followUp.userIds, expiresAt: Date.parse(now) + durationSeconds! * 1000 } } : {}),
                scope,
                sourceFingerprints,
                sourceOldestAt,
                revision: expectedRevision + 1,
                createdAt: current?.createdAt ?? now,
                updatedAt: now,
            };
            const row = (state: StatePayload): StateRow => ({
                id,
                owner: instance,
                platform: target.platform,
                selfId: target.selfId,
                channelId: target.channelId,
                channelType: target.channelType,
                retentionTimestamp: new Date(state.sourceOldestAt ?? state.updatedAt),
                schemaVersion: 1,
                payload: state,
            });
            await this.ctx.database.upsert(CONVERSATION_STATE, [row(payload)]);
            try {
                assertCurrent();
            } catch (error) {
                // Restore the previous committed state if authorization changed during the write.
                if (current) await this.ctx.database.upsert(CONVERSATION_STATE, [row(current)]);
                else await this.ctx.database.remove(CONVERSATION_STATE, { id });
                throw error;
            }
            this.invalidated.delete(id);
            return this.result(payload);
        });
    }
}
