/** Immutable per-extension, per-session forward snapshots. No child is fetched until requested. */
export class ForwardLayerCache {
    private entries = new Map<string, { scope: string; id: string; messages: unknown[]; bytes: number; expires: number }>();
    private bytes = 0;
    private readonly pins = new Map<string, number>();
    constructor(private readonly maxBytes = 16 * 1024 * 1024) {}
    private key(scope: string, id: string) {
        return JSON.stringify([scope, id]);
    }
    /** Keep every advertised snapshot alive while one page is being formatted. */
    beginRead() {
        const keys = new Set<string>();
        return {
            pin: (scope: string, id: string) => {
                const key = this.key(scope, id);
                if (!this.entries.has(key) || keys.has(key)) return;
                keys.add(key);
                this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
            },
            release: () => {
                for (const key of keys) {
                    const count = (this.pins.get(key) ?? 1) - 1;
                    if (count) this.pins.set(key, count);
                    else this.pins.delete(key);
                }
                keys.clear();
            },
        };
    }
    get(scope: string, id: string) {
        this.prune();
        const entry = this.entries.get(this.key(scope, id));
        return entry && structuredClone(entry.messages);
    }
    put(scope: string, id: string, messages: unknown[]) {
        this.prune();
        const bytes = Buffer.byteLength(JSON.stringify(messages));
        if (bytes > this.maxBytes) return false;
        const key = this.key(scope, id);
        const old = this.entries.get(key);
        if (old) {
            if (JSON.stringify(old.messages) !== JSON.stringify(messages)) throw new Error("相同转发 ID 对应不同内容，已保留原快照，请重新读取父包");
            return true;
        }
        while (this.entries.size >= 128 || this.bytes + bytes > this.maxBytes) {
            const evictable = [...this.entries.keys()].find((key) => !this.pins.has(key));
            if (!evictable) return false;
            this.remove(evictable);
        }
        this.entries.set(key, { scope, id, messages: structuredClone(messages), bytes, expires: Date.now() + 10 * 60_000 });
        this.bytes += bytes;
        return true;
    }
    private remove(key: string) {
        const old = this.entries.get(key);
        if (old) this.bytes -= old.bytes;
        this.entries.delete(key);
    }
    private prune() {
        for (const [key, value] of this.entries) if (value.expires <= Date.now() && !this.pins.has(key)) this.remove(key);
    }
}

export function forwardMessageList(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
        const row = value as Record<string, unknown>;
        if (Array.isArray(row.messages)) return row.messages;
        if (row.data && typeof row.data === "object" && Array.isArray((row.data as Record<string, unknown>).messages))
            return (row.data as { messages: unknown[] }).messages;
    }
    throw new Error("平台返回的转发消息列表缺失或无效");
}
