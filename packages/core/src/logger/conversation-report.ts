import { AsyncLocalStorage } from "node:async_hooks";

import { conversationChannelId } from "../shared/utils/conversation-scope";

type IdentityKind = "user" | "channel" | "message" | "bot";
type Identity = { id: string; kind: IdentityKind };
type Entry = { timestamp: string; kind: string; data: unknown };
export type ConversationReport = { entries: Entry[]; identities: Identity[]; omitted: number };

export interface ReportTarget {
    platform?: string;
    channelId?: string;
    guildId?: string;
    selfId?: string;
    userId?: string;
    messageId?: string;
    isDirect?: boolean;
}
type StoredEntry = { entry: Entry; ids: Identity[]; bytes: number; turn?: string; generation: object };
type Trace = { owner: ConversationReportRecorder; target: ReportTarget; key: string; turn?: string; generation: object };
const current = new AsyncLocalStorage<Trace | undefined>();

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 2048;
const MAX_AGE = 30 * 60 * 1000;

export class ConversationReportRecorder {
    private readonly entries: Array<StoredEntry & { key: string; time: number }> = [];
    private readonly generations = new Map<string, { channelId: string; platform: string; isDirect: boolean }>();
    private bytes = 0;
    private omitted = 0;
    private stopped = false;

    public start(target: ReportTarget, turn?: string): Trace | undefined {
        if (this.stopped || !target.platform || !target.channelId || !target.selfId) return;
        const channelId = conversationChannelId({
            platform: target.platform,
            channelId: target.channelId,
            guildId: target.guildId,
            isDirect: target.isDirect,
        })!;
        const key = JSON.stringify([target.platform, target.selfId, channelId]);
        let generation = this.generations.get(key);
        if (!generation) {
            if (this.generations.size >= MAX_ENTRIES) this.generations.delete(this.generations.keys().next().value!);
            generation = { platform: target.platform, channelId, isDirect: target.isDirect === true || channelId.startsWith("private:") };
            this.generations.set(key, generation);
        }
        return { owner: this, target, key, turn, generation };
    }

    public append(trace: Trace, kind: string, data: unknown): void {
        if (!this.valid(trace)) return;
        try {
            // Snapshot now: retries and tool completion can mutate the original arguments.
            const serialized = JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? String(value) : value));
            if (serialized === undefined) return;
            const bytes = Buffer.byteLength(serialized);
            if (bytes > MAX_BYTES) {
                this.omitted++;
                return;
            }
            const { userId, messageId, channelId, guildId, selfId } = trace.target;
            const ids: Identity[] = [];
            for (const [id, kind] of [
                [userId, "user"],
                [messageId, "message"],
                [channelId, "channel"],
                [guildId, "channel"],
                [selfId, "bot"],
            ] as const) {
                if (id) ids.push({ id, kind });
            }
            const time = Date.now();
            this.evict(time, bytes);
            this.entries.push({
                entry: { timestamp: new Date(time).toISOString(), kind, data: JSON.parse(serialized) },
                ids,
                key: trace.key,
                turn: trace.turn,
                generation: trace.generation,
                bytes,
                time,
            });
            this.bytes += bytes;
        } catch {
            this.omitted++;
        }
    }

    public snapshot(): ConversationReport | undefined {
        const trace = current.getStore();
        if (!trace || !this.valid(trace)) return;
        this.evict(Date.now(), 0, false);
        const rows = this.entries.filter(
            (row) =>
                row.key === trace.key &&
                row.generation === trace.generation &&
                (row.turn === trace.turn || row.entry.kind === "log" || row.entry.kind === "stimulus" || row.entry.kind === "decision"),
        );
        if (!rows.length) return;
        return { entries: rows.map(({ entry }) => entry), identities: rows.flatMap(({ ids }) => ids), omitted: this.omitted };
    }

    public clear(matches: (platform: string, channelId: string, isDirect: boolean) => boolean): void {
        for (const [key, target] of this.generations) {
            if (matches(target.platform, target.channelId, target.isDirect)) this.generations.delete(key);
        }
        for (let i = this.entries.length - 1; i >= 0; i--) {
            if (!this.generations.has(this.entries[i].key)) this.bytes -= this.entries.splice(i, 1)[0].bytes;
        }
    }

    public stop(): void {
        this.stopped = true;
        this.generations.clear();
        this.entries.length = 0;
        this.bytes = 0;
    }

    public valid(trace: Trace): boolean {
        return trace.owner === this && this.generations.get(trace.key) === trace.generation;
    }

    private evict(time: number, incoming: number, adding = true): void {
        while (
            this.entries.length &&
            (this.entries[0].time < time - MAX_AGE || (adding && this.entries.length >= MAX_ENTRIES) || this.bytes + incoming > MAX_BYTES)
        ) {
            this.bytes -= this.entries.shift()!.bytes;
            this.omitted++;
        }
    }
}

export type ConversationReportTrace = Trace;

export function withConversationReport<T>(trace: Trace | undefined, run: () => T): T {
    return current.run(trace, run);
}

export function isConversationReportEnabled(): boolean {
    const trace = current.getStore();
    return !!trace && trace.owner.valid(trace);
}

export function recordConversationReport(kind: string, data: unknown, owner?: ConversationReportRecorder): void {
    const trace = current.getStore();
    if (trace && (!owner || trace.owner === owner)) trace.owner.append(trace, kind, data);
}
