import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DecisionRecord } from "./decision-record";

export interface DecisionJournalOptions {
    maxEntries: number;
    maxBytes: number;
    retentionHours: number;
}

export interface DecisionJournalFilter {
    key?: string;
    from?: number;
    to?: number;
    limit?: number;
}

const stages = new Set([
    "received",
    "assessing",
    "calculated",
    "scheduled",
    "debounced",
    "queued",
    "deferred",
    "skipped",
    "running",
    "completed",
    "cancelled",
    "blocked",
    "failed",
]);
const stimuli = new Set(["user_message", "scheduled_task", "background_task_completion", "system_event", "cancellation"]);
const reasons = new Set([
    "stopped",
    "reply_suppressed",
    "permission_denied",
    "muted",
    "probability_roll",
    "below_threshold",
    "busy",
    "debounce_replaced",
    "assessment_replaced",
    "pause",
    "resume",
    "replace",
    "expired",
    "no_reply",
    "exception",
    "disposed",
    "not_scheduled",
    "invalid_generation",
]);
const calculationFields = [
    "before",
    "after",
    "baseScore",
    "interestMultiplier",
    "marginalMultiplier",
    "dynamicMultiplier",
    "assessmentMultiplier",
    "participationMultiplier",
    "effectiveGain",
    "maxWillingness",
    "threshold",
    "amplifier",
    "probability",
    "roll",
] as const;
const categories = new Set(["text", "at", "quote", "direct", "system", "scheduled", "background"]);
const identifier = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Explicit allowlist: never copy a caller's record or arbitrary nested objects. */
export function sanitizeDecisionRecord(value: unknown): DecisionRecord | undefined {
    if (
        !object(value) ||
        value.version !== 1 ||
        !identifier(value.id) ||
        !identifier(value.key) ||
        !finite(value.time) ||
        value.time < 0 ||
        typeof value.stage !== "string" ||
        typeof value.stimulusType !== "string"
    )
        return;
    const result: Record<string, unknown> = {
        version: 1,
        id: value.id,
        key: value.key,
        time: value.time,
        stage: stages.has(value.stage) ? value.stage : "unknown",
        stimulusType: stimuli.has(value.stimulusType) ? value.stimulusType : "unknown",
        startedAt: finite(value.startedAt) ? value.startedAt : value.time,
    };
    if (typeof value.reason === "string" && reasons.has(value.reason)) result.reason = value.reason;
    for (const field of ["decision", "success"] as const) if (typeof value[field] === "boolean") result[field] = value[field];
    for (const field of ["score", "probability", "roll"] as const) if (finite(value[field])) result[field] = value[field];
    if (object(value.calculation)) {
        const calculation: Record<string, number> = {};
        for (const field of calculationFields) if (finite(value.calculation[field])) calculation[field] = value.calculation[field];
        result.calculation = calculation;
        if (object(value.calculation.gains)) {
            const gains: Record<string, number> = {};
            for (const field of ["text", "at", "quote", "direct"] as const)
                if (finite(value.calculation.gains[field])) gains[field] = value.calculation.gains[field];
            (result.calculation as Record<string, unknown>).gains = gains;
        }
    }
    if (
        object(value.target) &&
        identifier(value.target.platform) &&
        identifier(value.target.selfId) &&
        identifier(value.target.channelId)
    ) {
        result.target = {
            platform: value.target.platform,
            selfId: value.target.selfId,
            channelId: value.target.channelId,
            ...(typeof value.target.isDirect === "boolean" ? { isDirect: value.target.isDirect } : {}),
        };
    }
    if (Array.isArray(value.allowed))
        result.allowed = [...new Set(value.allowed.filter((item) => typeof item === "string" && categories.has(item)))];
    if (
        object(value.assessment) &&
        ["off", "observe", "adjust"].includes(value.assessment.mode as string) &&
        ["bypassed", "pending", "completed", "unavailable", "cancelled"].includes(value.assessment.status as string)
    ) {
        const assessment: Record<string, unknown> = {
            mode: value.assessment.mode,
            status: value.assessment.status,
            multiplier: finite(value.assessment.multiplier) ? value.assessment.multiplier : null,
        };
        if (object(value.assessment.answers)) {
            const answers: Record<string, number> = {};
            for (const field of ["addressed", "interested", "others"] as const)
                if (finite(value.assessment.answers[field])) answers[field] = value.assessment.answers[field];
            assessment.answers = answers;
        }
        result.assessment = assessment;
    }
    if (object(value.participation) && typeof value.participation.active === "boolean") {
        const participation: Record<string, unknown> = { active: value.participation.active };
        for (const field of ["lastReplyAt", "expiresAt"] as const)
            if (finite(value.participation[field])) participation[field] = value.participation[field];
        if (identifier(value.participation.participantId)) participation.participantId = value.participation.participantId;
        result.participation = participation;
    }
    return result as unknown as DecisionRecord;
}

interface Entry {
    record: DecisionRecord;
    line: string;
    bytes: number;
}

/** One writer per directory. All I/O failures are isolated from live decisions. */
export class DecisionJournal {
    readonly filePath: string;
    private entries: Entry[] = [];
    private bytes = 0;
    private queuedBytes = 0;
    private queuedEntries = 0;
    private queue: Promise<void>;
    private closed = false;
    private closePromise?: Promise<void>;
    private dirty = false;
    private ready = false;
    private lastWarning = "";
    private readonly options: DecisionJournalOptions;
    private counts = {
        droppedRecords: 0,
        invalidRecords: 0,
        incompatibleRecords: 0,
        oversizedRecords: 0,
        trimmedRecords: 0,
        writeFailures: 0,
    };

    get diagnostics(): Readonly<typeof this.counts> {
        return { ...this.counts };
    }

    constructor(
        private readonly directory: string,
        options: DecisionJournalOptions,
        private readonly warn?: (message: string) => void
    ) {
        this.options = {
            maxEntries: finite(options.maxEntries) ? Math.max(1, Math.floor(options.maxEntries)) : 1000,
            maxBytes: finite(options.maxBytes) ? Math.max(1, Math.floor(options.maxBytes)) : 1048576,
            retentionHours: finite(options.retentionHours) ? Math.max(0, options.retentionHours) : 24,
        };
        this.filePath = join(directory, "decisions.jsonl");
        this.queue = this.recover().catch(() => {
            this.counts.writeFailures++;
            this.warning("Decision journal initialization failed; recording is unavailable.");
        });
    }

    private warning(message: string): void {
        // Never expose exception messages, paths or user supplied data in warnings.
        if (message === this.lastWarning) return;
        this.lastWarning = message;
        try {
            this.warn?.(message);
        } catch {
            /* logging must not affect replies */
        }
    }

    private enqueue(task: () => Promise<void>): Promise<void> {
        this.queue = this.queue.then(task).catch(() => {
            this.dirty = true;
            this.counts.writeFailures++;
            this.warning("Decision journal I/O failed; live decisions are unaffected.");
        });
        return this.queue;
    }

    private trim(): void {
        const previousLength = this.entries.length;
        const cutoff = Date.now() - this.options.retentionHours * 3600000;
        const retained = this.entries.filter((entry) => entry.record.time >= cutoff);
        if (retained.length !== this.entries.length) {
            this.entries = retained;
            this.bytes = retained.reduce((sum, entry) => sum + entry.bytes, 0);
            this.dirty = true;
        }
        while (this.entries.length > this.options.maxEntries || this.bytes > this.options.maxBytes) {
            this.bytes -= this.entries.shift()!.bytes;
            this.dirty = true;
        }
        const removed = previousLength - this.entries.length;
        if (removed) {
            this.counts.trimmedRecords += removed;
            this.counts.droppedRecords += removed;
            this.warning("Decision journal records were trimmed by capacity or retention; history is incomplete.");
        }
    }

    private add(record: DecisionRecord): Entry {
        const line = JSON.stringify(record) + "\n";
        const entry = { record, line, bytes: Buffer.byteLength(line) };
        this.entries.push(entry);
        this.bytes += entry.bytes;
        this.trim();
        return entry;
    }

    private async recover(): Promise<void> {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const directoryStat = await lstat(this.directory);
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("unsafe directory");
        await chmod(this.directory, 0o700);
        try {
            const stat = await lstat(this.filePath);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unsafe journal");
            const input = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                await input.chmod(0o600);
                let pending = Buffer.alloc(0);
                let oversized = false;
                const maximumLine = Math.min(this.options.maxBytes, 1024 * 1024);
                const accept = (line: Buffer) => {
                    if (!line.length) return;
                    try {
                        const value: unknown = JSON.parse(line.toString("utf8"));
                        if (object(value) && value.version !== 1) {
                            this.counts.incompatibleRecords++;
                            this.counts.droppedRecords++;
                            this.warning("Decision journal contains an incompatible version; records were skipped.");
                            this.dirty = true;
                            return;
                        }
                        const record = sanitizeDecisionRecord(value);
                        if (!record) throw new Error("invalid record");
                        if (
                            object(value) &&
                            object(value.calculation) &&
                            calculationFields.some((field) => !finite(value.calculation[field]))
                        )
                            this.warning("Decision journal calculation metadata is incomplete; offline replay will report missing fields.");
                        const entry = this.add(record);
                        // Compact when sanitization removed fields or normalized metadata.
                        if (line.toString("utf8") + "\n" !== entry.line) this.dirty = true;
                    } catch {
                        this.counts.invalidRecords++;
                        this.counts.droppedRecords++;
                        this.dirty = true;
                        this.warning("Decision journal contains corrupt or missing metadata; records were skipped.");
                    }
                };
                for await (const chunk of input.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 })) {
                    const data = chunk as Buffer;
                    let offset = 0;
                    while (offset < data.length) {
                        const newline = data.indexOf(10, offset);
                        const end = newline === -1 ? data.length : newline;
                        const part = data.subarray(offset, end);
                        if (!oversized) {
                            if (pending.length + part.length > maximumLine) {
                                oversized = true;
                                this.counts.oversizedRecords++;
                                this.counts.droppedRecords++;
                                pending = Buffer.alloc(0);
                                this.dirty = true;
                                this.warning("Decision journal contains oversized records; records were skipped.");
                            } else pending = Buffer.concat([pending, part]);
                        }
                        if (newline !== -1) {
                            if (!oversized) accept(pending);
                            pending = Buffer.alloc(0);
                            oversized = false;
                        }
                        offset = end + (newline === -1 ? 0 : 1);
                    }
                }
                // An unterminated line may be a partial write and is deliberately discarded.
                if (pending.length || oversized) {
                    if (!oversized) {
                        this.counts.invalidRecords++;
                        this.counts.droppedRecords++;
                    }
                    this.dirty = true;
                    this.warning("Decision journal contains an incomplete final record; record was skipped.");
                }
                this.trim();
                if (stat.size > this.options.maxBytes) this.dirty = true;
            } finally {
                await input.close();
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            this.dirty = true;
        }
        this.ready = true;
        if (this.dirty) await this.compact();
    }

    private async compact(): Promise<void> {
        if (!this.ready) return;
        const temporary = join(this.directory, `.decisions-${randomUUID()}.tmp`);
        const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try {
            for (const entry of this.entries) await handle.writeFile(entry.line);
            await handle.sync();
            await handle.close();
            await rename(temporary, this.filePath);
            this.dirty = false;
        } finally {
            await handle.close().catch(() => {});
            await unlink(temporary).catch(() => {});
        }
    }

    append(value: DecisionRecord): Promise<void> {
        if (this.closed) return Promise.resolve();
        let record: DecisionRecord | undefined;
        try {
            record = sanitizeDecisionRecord(value);
        } catch {
            /* reject exotic caller objects */
        }
        if (!record) {
            this.counts.invalidRecords++;
            this.counts.droppedRecords++;
            this.warning("Decision journal rejected a record with invalid or missing metadata.");
            return Promise.resolve();
        }
        if (record.stage === "unknown" || record.stimulusType === "unknown")
            this.warning("Decision journal normalized unknown stage or stimulus metadata.");
        const size = Buffer.byteLength(JSON.stringify(record) + "\n");
        if (size > Math.min(this.options.maxBytes, 1024 * 1024)) {
            this.counts.oversizedRecords++;
            this.counts.droppedRecords++;
            this.warning("Decision journal rejected an oversized record.");
            return Promise.resolve();
        }
        if (this.queuedEntries >= this.options.maxEntries || this.queuedBytes + size > this.options.maxBytes) {
            this.counts.droppedRecords++;
            this.warning("Decision journal write queue is full; a record was dropped.");
            return Promise.resolve();
        }
        this.queuedEntries++;
        this.queuedBytes += size;
        return this.enqueue(async () => {
            try {
                if (!this.ready) {
                    this.counts.droppedRecords++;
                    return;
                }
                const entry = this.add(record!);
                if (this.dirty) await this.compact();
                else {
                    const handle = await open(
                        this.filePath,
                        constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
                        0o600
                    );
                    try {
                        await handle.chmod(0o600);
                        await handle.writeFile(entry.line);
                    } finally {
                        await handle.close();
                    }
                }
            } finally {
                this.queuedEntries--;
                this.queuedBytes -= size;
            }
        });
    }

    async list(filter: DecisionJournalFilter = {}): Promise<DecisionRecord[]> {
        await this.queue;
        this.trim();
        const records = this.entries
            .filter(
                ({ record }) =>
                    (filter.key === undefined || record.key === filter.key) &&
                    (filter.from === undefined || record.time >= filter.from) &&
                    (filter.to === undefined || record.time <= filter.to)
            )
            .map((entry) => entry.record);
        const limit = filter.limit === undefined ? records.length : Math.max(0, Math.floor(filter.limit));
        // Return copies: callers cannot mutate journal contents or inject metadata.
        return JSON.parse(JSON.stringify(limit > 0 ? records.slice(-limit) : []));
    }

    flush(): Promise<void> {
        return this.enqueue(async () => {
            if (!this.ready) return;
            this.trim();
            if (this.dirty) await this.compact();
            const handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                await handle.sync();
            } finally {
                await handle.close();
            }
        });
    }

    close(): Promise<void> {
        if (!this.closePromise) {
            this.closed = true;
            this.closePromise = this.flush();
        }
        return this.closePromise;
    }
}
