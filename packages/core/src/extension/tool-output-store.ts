import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ToolOutputOwner {
    instance: string;
    platform: string;
    selfId: string;
    channelId: string;
    channelType: "guild" | "private";
    generation: number;
    privateUserId?: string;
}
const TTL = 24 * 60 * 60 * 1000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_FOLDER_BYTES = 256 * 1024 * 1024;
const FILE_NAME = /^[a-f0-9-]{36}\.json(?:\.tmp)?$/;
const RESOURCE = /^tool-output:\/\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
export const TOOL_OUTPUT_THRESHOLD = 24000;
export const TOOL_OUTPUT_PAGE_LIMIT = 8000;
const format = { encoding: "json", offsetUnit: "utf16-code-unit" } as const;

/** Immutable, instance-local resources. Boot nonce deliberately expires old references on reload. */
export class ToolOutputStore {
    private readonly boot = randomUUID();
    private queue: Promise<unknown> = Promise.resolve();
    constructor(private readonly directory: string) {}

    public async save(text: string, owner: ToolOutputOwner, assertCurrent: () => void) {
        const operation = this.queue.then(async () => {
            assertCurrent();
            await mkdir(this.directory, { recursive: true, mode: 0o700 });
            const names = (await readdir(this.directory)).filter((name) => FILE_NAME.test(name));
            let bytes = 0,
                count = 0;
            for (const name of names) {
                const file = path.join(this.directory, name);
                try {
                    const info = await stat(file);
                    if (Date.now() - info.mtimeMs >= TTL) await rm(file, { force: true });
                    else {
                        bytes += info.size;
                        count++;
                    }
                } catch (error) {
                    if (error.code !== "ENOENT") throw error;
                }
            }
            const id = randomUUID();
            const expiresAt = new Date(Date.now() + TTL).toISOString();
            const data = JSON.stringify({ owner, boot: this.boot, expiresAt, text });
            const size = Buffer.byteLength(data);
            if (size > MAX_FILE_BYTES || bytes + size > MAX_FOLDER_BYTES || count >= 512) throw new Error("Tool output resource storage capacity exceeded");
            const file = path.join(this.directory, `${id}.json`),
                temporary = `${file}.tmp`;
            try {
                assertCurrent();
                await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
                assertCurrent();
                await rename(temporary, file);
                assertCurrent();
            } catch (error) {
                await Promise.all([rm(temporary, { force: true }), rm(file, { force: true })]);
                throw error;
            }
            return {
                kind: "tool-output-resource" as const,
                uri: `tool-output://${id}`,
                preview: text.slice(0, 1200),
                totalLength: text.length,
                ...format,
                nextOffset: Math.min(1200, text.length),
                expiresAt,
                lifetime: "Expires after 24 hours or service reload",
            };
        });
        this.queue = operation.catch(() => {});
        return operation;
    }

    public async read(uri: string, owner: ToolOutputOwner, offset = 0, limit = 6000, assertCurrent: () => void) {
        assertCurrent();
        const match = RESOURCE.exec(uri);
        if (!match) throw new Error("Invalid tool-output resource URI");
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > TOOL_OUTPUT_PAGE_LIMIT)
            throw new Error("Invalid character range (limit 1–8000 UTF-16 code units)");
        const file = path.join(this.directory, `${match[1]}.json`);
        const info = await stat(file);
        assertCurrent();
        if (info.size > MAX_FILE_BYTES) throw new Error("Invalid resource size");
        const resource = JSON.parse(await readFile(file, "utf8"));
        assertCurrent();
        if (resource.boot !== this.boot || Date.parse(resource.expiresAt) <= Date.now())
            throw new Error("Tool output resource expired (24 hours or service reload)");
        if (!resource.owner || (Object.keys(owner) as Array<keyof ToolOutputOwner>).some((key) => owner[key] !== resource.owner[key]))
            throw new Error("Tool output resource scope denied");
        if (typeof resource.text !== "string" || offset > resource.text.length) throw new Error("Invalid resource character range");
        const end = Math.min(offset + limit, resource.text.length);
        return {
            uri,
            text: resource.text.slice(offset, end),
            offset,
            nextOffset: end < resource.text.length ? end : null,
            totalLength: resource.text.length,
            ...format,
            expiresAt: resource.expiresAt,
        };
    }
}
