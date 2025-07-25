import fs from "fs";
import { readFile, stat } from "fs/promises";
import matter from "gray-matter";
import { Context, Logger } from "koishi";

import { Services } from "@/shared/constants";
import { AppError, ErrorCodes } from "@/shared/errors";
import { MemoryBlockData } from "./types";

export class MemoryBlock {
    private _metadata: Omit<MemoryBlockData, "content">;
    private _content: string[];
    private lastModifiedInMemory: Date = new Date();
    private _filePath: string;

    private watcher?: fs.FSWatcher;
    private debounceTimer?: NodeJS.Timeout;
    private lastModifiedFileMs: number = 0;

    private readonly logger: Logger;

    private constructor(ctx: Context, filePath: string, data: MemoryBlockData, initialFileMtimeMs: number) {
        this.logger = ctx[Services.Logger].getLogger(`[核心记忆] [${data.label}]`);
        this._filePath = filePath;
        this._metadata = {
            title: data.title,
            label: data.label,
            description: data.description,
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

    public dispose(): void {
        this.stopWatching();
    }

    public toData(): MemoryBlockData {
        return {
            title: this.title,
            label: this.label,
            description: this.description,
            content: [...this.content],
        };
    }

    // --- File Watching and Sync ---

    private async reloadFromFile(): Promise<void> {
        this.logger.debug(`开始同步 | 文件 -> 内存`);
        try {
            const block = await MemoryBlock.loadDataFromFile(this._filePath);
            this._metadata = {
                title: block.title,
                label: block.label,
                description: block.description,
            };
            this._content = block.content;
            this.lastModifiedInMemory = new Date();
            this.logger.debug(`同步成功`);
        } catch (error) {
            this.logger.error(`同步失败 | 错误: ${error.message}`);
        }
    }

    public async startWatching(): Promise<void> {
        if (this.watcher) return;
        // this.logger.debug(`[文件监视] 启动 | 路径: ${this.filePath}`);
        this.watcher = fs.watch(this._filePath, (eventType) => {
            if (this.debounceTimer) clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(async () => {
                try {
                    if (!fs.existsSync(this.filePath)) {
                        this.logger.warn(`文件已删除，停止监听 | 路径: ${this.filePath}`);
                        await this.stopWatching();
                        return;
                    }
                    const currentFstat = await stat(this.filePath);
                    if (currentFstat.mtimeMs > this.lastModifiedFileMs) {
                        this.logger.debug(`文件变更，开始同步 | 路径: ${this.filePath}`);
                        this.lastModifiedFileMs = currentFstat.mtimeMs;
                        await this.reloadFromFile();
                    }
                } catch (error) {
                    this.logger.error(`处理变更时出错 | 错误: ${error.message}`);
                }
            }, 300);
        });
        this.watcher.on("error", (err) => {
            this.logger.error(`出现严重错误，已停止 | 错误: ${err.message}`);
            this.stopWatching();
        });
    }

    private stopWatching(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = undefined;
            // this.logger.debug(`[文件监视] 停止 | 路径: ${this.filePath}`);
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
    }

    // --- Static Factory ---

    public static async createFromFile(ctx: Context, filePath: string): Promise<MemoryBlock> {
        const logger = ctx[Services.Logger].getLogger("[核心记忆]");
        try {
            const fileStats = await stat(filePath);
            const blockData = await this.loadDataFromFile(filePath);

            // logger.debug(`加载实例 | 标签: "${data.label}", 路径: "${filePath}"`);
            const block = new MemoryBlock(ctx, filePath, blockData, fileStats.mtimeMs);

            await block.startWatching();
            ctx.on("dispose", () => block.dispose());

            return block;
        } catch (error) {
            logger.error(`加载失败 | 路径: "${filePath}" | 错误: ${error.message}`);
            throw new AppError(`Failed to create MemoryBlock from file: ${filePath}`, {
                code: ErrorCodes.RESOURCE.STORAGE_FAILURE,
                context: { filePath },
                cause: error,
            });
        }
    }

    private static async loadDataFromFile(filePath: string): Promise<MemoryBlockData> {
        const rawContent = await readFile(filePath, "utf-8");
        const { data, content } = matter(rawContent);

        // Validate metadata
        if (!data.label) {
            throw new Error(`缺少必要的元数据字段 (label)`);
        }

        return {
            title: data.title,
            label: data.label,
            description: data.description || "",
            content: content.trim() ? content.trim().split(/\r?\n/) : [],
        };
    }
}
