import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { Context, Logger } from "koishi";
import path from "path";
import matter from "gray-matter";
import fs from "fs";

import { AppError, ErrorCodes, isEmpty, truncate } from "../../shared";
import { Services } from "../types";
import { MemoryBlockData, MemoryBlockMetadata } from "./types";

export class MemoryBlock {
    private _metadata: MemoryBlockMetadata;
    private _content: string[];
    private lastModifiedInMemory: Date = new Date();
    private _filePath: string;

    private watcher?: fs.FSWatcher;
    private debounceTimer?: NodeJS.Timeout;
    private lastModifiedFileMs: number = 0;

    private readonly logger: Logger;

    private constructor(ctx: Context, filePath: string, data: MemoryBlockData, initialFileMtimeMs: number) {
        this.logger = ctx[Services.Logger].getLogger(`[记忆块] [${data.label}]`);
        this._filePath = filePath;
        this._metadata = {
            title: data.title,
            label: data.label,
            description: data.description,
            limit: data.limit,
        };
        this._content = data.content;
        this.lastModifiedFileMs = initialFileMtimeMs;
    }

    // --- Getters ---
    get title(): string {
        return this._metadata.title;
    }
    get label(): string {
        return this._metadata.label;
    }
    get description(): string {
        return this._metadata.description;
    }
    get limit(): number {
        return this._metadata.limit;
    }
    get content(): readonly string[] {
        return this._content;
    }
    get lastModified(): Date {
        return this.lastModifiedInMemory;
    }
    get currentSize(): number {
        return this._content.reduce((sum, item) => sum + item.length, 0);
    }
    get filePath(): string {
        return this._filePath;
    }

    // --- Public Methods ---

    public async append(content: string): Promise<void> {
        this.checkMemoryLimitOrThrow(content.length);
        this._content.push(content);
        this.lastModifiedInMemory = new Date();
        await this.persistToFile();
        this.logger.debug(`追加内容 | 内容: "${truncate(content)}"`);
    }

    public async replace(oldContent: string, newContent: string): Promise<void> {
        const index = this._content.findIndex((item) => item === oldContent);
        if (index === -1) {
            throw new AppError(`Content to replace not found in ${this.label}`, {
                code: ErrorCodes.RESOURCE.NOT_FOUND,
                context: { resourceType: "MemoryBlock", resourceId: this.label, content: oldContent },
            });
        }

        if (isEmpty(newContent)) {
            this._content.splice(index, 1);
            this.logger.debug(`删除内容 | 内容: "${truncate(oldContent)}"`);
        } else {
            const sizeDiff = newContent.length - (this._content[index]?.length || 0);
            if (sizeDiff > 0) this.checkMemoryLimitOrThrow(sizeDiff);
            this._content[index] = newContent;
            this.logger.debug(`替换内容 | 旧: "${truncate(oldContent)}" -> 新: "${truncate(newContent)}"`);
        }
        this.lastModifiedInMemory = new Date();
        await this.persistToFile();
    }

    public async overwrite(newContentLines: string[]): Promise<void> {
        const newTotalSize = newContentLines.reduce((sum, item) => sum + item.length, 0);
        if (newTotalSize > this.limit) {
            const errorMsg = `Overwrite failed: new content size (${newTotalSize}) exceeds limit (${this.limit})`;
            this.logger.warn(errorMsg);
            throw new AppError(errorMsg, {
                code: ErrorCodes.RESOURCE.LIMIT_EXCEEDED,
                context: { newSize: newTotalSize, limit: this.limit, label: this.label },
            });
        }

        this._content = newContentLines;
        this.lastModifiedInMemory = new Date();
        await this.persistToFile();
        this.logger.debug(`记忆块内容已被完全覆盖`);
    }

    public async clear(): Promise<void> {
        this._content = [];
        this.lastModifiedInMemory = new Date();
        await this.persistToFile();
        this.logger.debug(`记忆块已清空`);
    }

    public async disposeFileWatcher(): Promise<void> {
        this.logger.debug(`[文件监视] 正在释放资源`);
        await this.stopWatching();
    }

    // --- Persistence ---

    private async persistToFile(): Promise<void> {
        try {
            const fileContent = matter.stringify(this._content.join("\n"), this._metadata);
            await writeFile(this._filePath, fileContent, "utf-8");
            const fstat = await stat(this._filePath);
            this.lastModifiedFileMs = fstat.mtimeMs; // Update file modification time to prevent echo-sync
            this.logger.debug(`持久化 | 已保存至文件: ${this.filePath}`);
        } catch (error) {
            this.logger.error(`持久化 | 保存失败: ${error.message}`);
            throw new AppError(`Persistence failed for ${this.label}`, {
                code: ErrorCodes.RESOURCE.STORAGE_FAILURE,
                context: { label: this.label, filePath: this._filePath },
                cause: error,
            });
        }
    }

    // --- File Watching and Sync ---

    private async reloadFromFile(): Promise<void> {
        this.logger.debug(`[文件同步] 开始 | 文件 -> 内存`);
        try {
            const { data, content } = await MemoryBlock.loadDataFromFile(this._filePath);
            this._metadata = data;
            this._content = content;
            this.lastModifiedInMemory = new Date();
            this.logger.debug(`[文件同步] 成功`);
        } catch (error) {
            this.logger.error(`[文件同步] 失败 | 错误: ${error.message}`);
        }
    }

    public async startWatching(): Promise<void> {
        if (this.watcher) return;
        this.logger.debug(`[文件监视] 启动 | 路径: ${this.filePath}`);
        this.watcher = fs.watch(this._filePath, (eventType) => {
            if (this.debounceTimer) clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(async () => {
                try {
                    if (!fs.existsSync(this.filePath)) {
                        this.logger.warn(`[文件监视] 文件已删除，停止监视 | 路径: ${this.filePath}`);
                        await this.stopWatching();
                        // Optional: Notify MemoryService to remove this block
                        return;
                    }
                    const currentFstat = await stat(this.filePath);
                    if (currentFstat.mtimeMs > this.lastModifiedFileMs) {
                        this.logger.debug(`[文件监视] 文件变更，开始同步 | 路径: ${this.filePath}`);
                        this.lastModifiedFileMs = currentFstat.mtimeMs;
                        await this.reloadFromFile();
                    }
                } catch (error) {
                    this.logger.error(`[文件监视] 处理变更时出错 | 错误: ${error.message}`);
                }
            }, 300);
        });
        this.watcher.on("error", (err) => {
            this.logger.error(`[文件监视] 出现严重错误，已停止 | 错误: ${err.message}`);
            this.stopWatching();
        });
    }

    private stopWatching(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = undefined;
            this.logger.debug(`[文件监视] 停止 | 路径: ${this.filePath}`);
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
    }

    // --- Static Factory ---

    public static async createFromFile(ctx: Context, filePath: string): Promise<MemoryBlock> {
        const logger = ctx.logger("MemoryBlock");
        try {
            const fileStats = await stat(filePath);
            const { data, content } = await this.loadDataFromFile(filePath);

            logger.debug(`[CreateFromFile] 加载实例 | 标签: "${data.label}", 路径: "${filePath}"`);
            const block = new MemoryBlock(ctx, filePath, { ...data, content }, fileStats.mtimeMs);

            await block.startWatching();
            ctx.on("dispose", () => block.disposeFileWatcher());

            return block;
        } catch (error) {
            logger.error(`[CreateFromFile] 操作失败 | 路径: "${filePath}" | 错误: ${error.message}`);
            throw new AppError(`Failed to create MemoryBlock from file: ${filePath}`, {
                code: ErrorCodes.RESOURCE.STORAGE_FAILURE,
                context: { filePath },
                cause: error,
            });
        }
    }

    private static async loadDataFromFile(filePath: string): Promise<{ data: MemoryBlockMetadata; content: string[] }> {
        const rawContent = await readFile(filePath, "utf-8");
        const { data, content } = matter(rawContent);

        // Validate metadata
        if (!data.label || !data.title || !data.limit) {
            throw new Error(`文件 ${filePath} 的 YAML Front Matter 缺少必要的元数据字段 (title, label, limit)`);
        }

        return {
            data: {
                title: data.title,
                label: data.label,
                description: data.description || "",
                limit: Number(data.limit),
            },
            content: content.trim() ? content.trim().split(/\r?\n/) : [],
        };
    }

    private checkMemoryLimitOrThrow(additionalContentLength: number): void {
        if (this.currentSize + additionalContentLength > this.limit) {
            const errorMsg = `超出容量限制 | 当前: ${this.currentSize}, 新增: ${additionalContentLength}, 限制: ${this.limit}`;
            this.logger.warn(errorMsg);
            throw new AppError(errorMsg, {
                code: ErrorCodes.RESOURCE.LIMIT_EXCEEDED,
                context: { currentSize: this.currentSize, contentLength: additionalContentLength, limit: this.limit, label: this.label },
            });
        }
    }
}
