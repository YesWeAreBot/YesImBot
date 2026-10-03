import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { sanitizeDiagnostic } from "@/shared/diagnostic-sanitizer";

export interface LocalLoggingConfig {
    enabled: boolean;
    directory: string;
    level: 1 | 2 | 3;
    maxFileSizeMB: number;
    maxFiles: number;
    retentionDays: number;
}

// Preserve the existing local logger helper API while sharing the filtering implementation.
export function sanitizeLog(value: unknown, seen = new Set<object>(), depth = 0): unknown {
    return sanitizeDiagnostic(value, [], seen, depth);
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
            line = JSON.stringify(sanitizeDiagnostic(record, this.secrets)) + "\n";
            // Custom toJSON methods can reintroduce credentials after object filtering.
            const secrets = this.secrets.filter(Boolean).map(secret => JSON.stringify(secret).slice(1, -1))
                .sort((a, b) => b.length - a.length);
            for (const secret of secrets) line = line.split(secret).join("[REDACTED]");
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
