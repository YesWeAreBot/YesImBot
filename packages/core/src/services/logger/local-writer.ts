import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export interface LocalLoggingConfig {
    enabled: boolean;
    directory: string;
    level: 1 | 2 | 3;
    maxFileSizeMB: number;
    maxFiles: number;
    retentionDays: number;
}

const secretKey = /^(authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)$/i;

function redactText(text: string): string {
    const keys = "authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret";
    return text
        // JSON 字符串可能嵌在错误描述中，先处理完整的带引号字段值。
        .replace(new RegExp(`("(?:${keys})"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, "gi"), '$1"[REDACTED]"')
        .replace(new RegExp(`('(?:${keys})'\\s*:\\s*)'(?:\\\\.|[^'\\\\])*'`, "gi"), "$1'[REDACTED]'")
        // 非结构化 header / 配置文本按整行遮蔽，避免带空格的值泄露后半段。
        .replace(new RegExp(`(\\b(?:${keys})\\s*[:=]\\s*)[^\\r\\n]+`, "gi"), "$1[REDACTED]")
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.\-]+/gi, "$1 [REDACTED]")
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

/** Error 的不可枚举字段也需保留；日志序列化不能修改业务对象。 */
export function sanitizeLog(value: unknown, seen = new Set<object>(), depth = 0): unknown {
    if (typeof value === "string") return redactText(value);
    if (typeof value === "bigint") return String(value);
    if (!value || typeof value !== "object") return value;
    if (depth > 20) return "[Depth limit]";
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    try {
        if (value instanceof Date) return value.toISOString();
        if (Array.isArray(value)) return value.map(item => sanitizeLog(item, seen, depth + 1));
        const keys = value instanceof Error
            ? [...new Set(["name", "message", "stack", "cause", ...Object.getOwnPropertyNames(value)])]
            : Object.keys(value);
        return Object.fromEntries(keys.map(key => [key, secretKey.test(key) ? "[REDACTED]" : sanitizeLog(value[key], seen, depth + 1)]));
    } finally {
        seen.delete(value);
    }
}

/** 独立于控制台和远程上报的顺序写入器。失败只通知控制台，不向业务抛出。 */
export class LocalLogWriter {
    private tail = Promise.resolve();
    private file: string;
    private bytes = 0;
    private queuedBytes = 0;
    private closed = false;
    private lastWarning = 0;
    private lastCleanup = 0;
    public readonly directory: string;

    constructor(baseDir: string, private readonly config: LocalLoggingConfig, private readonly warn: (message: string) => void, private readonly secrets: string[] = []) {
        this.directory = path.resolve(baseDir, config.directory || "data/yesimbot/debug_logs");
    }

    public write(record: unknown): Promise<void> {
        if (this.closed) return Promise.resolve();
        let line: string;
        try {
            line = JSON.stringify(sanitizeLog(record)) + "\n";
            for (const secret of this.secrets) {
                if (secret) line = line.split(JSON.stringify(secret).slice(1, -1)).join("[REDACTED]");
            }
        }
        catch { this.warning("本地日志序列化失败"); return Promise.resolve(); }
        const bytes = Buffer.byteLength(line);
        if (this.queuedBytes + bytes > 32 * 1024 * 1024) {
            this.warning("本地日志写入队列已满，本条日志未保存");
            return Promise.resolve();
        }
        this.queuedBytes += bytes;
        this.tail = this.tail.then(async () => {
            await fs.mkdir(this.directory, { recursive: true });
            if (!this.file || (this.bytes > 0 && this.bytes + bytes > Math.max(1, this.config.maxFileSizeMB) * 1024 * 1024)) {
                this.file = `yesimbot-debug-${Date.now()}-${randomUUID()}.jsonl`;
                this.bytes = 0;
                this.lastCleanup = 0;
            }
            await fs.appendFile(path.join(this.directory, this.file), line, { encoding: "utf8", mode: 0o600 });
            this.bytes += bytes;
            if (Date.now() - this.lastCleanup > 60000) {
                await this.cleanup();
                this.lastCleanup = Date.now();
            }
        }).catch(() => {
            this.file = undefined;
            this.bytes = 0;
            this.warning("本地日志写入失败，请检查日志目录权限和磁盘空间");
        }).finally(() => { this.queuedBytes -= bytes; });
        return this.tail;
    }

    private async cleanup(): Promise<void> {
        const names = (await fs.readdir(this.directory)).filter(name => /^yesimbot-debug-\d+-[0-9a-f-]+\.jsonl$/.test(name));
        const files = await Promise.all(names.map(async name => ({ name, stat: await fs.stat(path.join(this.directory, name)) })));
        files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
        const keep = Math.max(1, this.config.maxFiles);
        const cutoff = Date.now() - this.config.retentionDays * 86400000;
        for (let i = 0; i < files.length; i++) {
            const { name, stat } = files[i];
            if (name !== this.file && (i >= keep || (this.config.retentionDays > 0 && stat.mtimeMs < cutoff))) {
                await fs.unlink(path.join(this.directory, name));
            }
        }
    }

    private warning(message: string): void {
        if (Date.now() - this.lastWarning < 60000) return;
        this.lastWarning = Date.now();
        this.warn(message);
    }

    public async close(): Promise<void> {
        this.closed = true;
        await this.tail;
    }
}
