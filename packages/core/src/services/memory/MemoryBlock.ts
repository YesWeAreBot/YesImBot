import fs from "fs";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { Context, Logger } from "koishi";
import path from "path";

import { isEmpty } from "../../shared";
import { ChatModel } from "../model";
import { DatabaseMemoryBlockStore, IMemoryBlockStore } from "./DatabaseMemoryBlockStore";
import { MemoryError } from "./MemoryError";
import { MemoryBlockData } from "./types";
import { MEMORY_TABLE } from "./config";

export class MemoryBlock {
    private _id: string;
    private _label: string;
    private _limit: number;
    private _content: string[];
    private lastModifiedInMemory: Date = new Date();

    private filePath?: string;
    private watcher?: fs.FSWatcher;
    private debounceTimer?: NodeJS.Timeout;
    private lastModifiedFileMs: number = 0;

    private readonly logger: Logger;

    constructor(private readonly ctx: Context, data: MemoryBlockData, private readonly store: IMemoryBlockStore, filePathToBind?: string) {
        this.logger = ctx.logger(MemoryBlock.name);
        this._id = data.id;
        this._label = data.label;
        this._limit = data.limit;
        this._content = Array.isArray(data.content) ? [...data.content] : [];

        this.logger.debug(`Created: ${this._label} (ID: ${this._id}), Limit: ${this._limit}, Store: ${store.constructor.name}`);

        if (filePathToBind) {
            this.bindFile(filePathToBind).catch((err) => {
                this.logger.error(`Failed to auto-bind file "${filePathToBind}" on construction: ${err.message}`);
            });
        }
    }

    get id(): string {
        return this._id;
    }
    get label(): string {
        return this._label;
    }
    get limit(): number {
        return this._limit;
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

    public async append(content: string): Promise<void> {
        this.checkMemoryLimitOrThrow(content.length);
        this._content.push(content);
        this.lastModifiedInMemory = new Date();
        await this.persistToStoreAndFile();
        this.logger.debug(`Appended to ${this._label}, new size: ${this.currentSize}`);
    }

    public async replace(oldContent: string, newContent: string): Promise<void> {
        const index = this._content.findIndex((item) => item === oldContent);
        if (index === -1) {
            throw new MemoryError(`Content to replace not found in ${this._label}`, { oldContent, label: this._label });
        }

        if (isEmpty(newContent)) {
            this._content.splice(index, 1);
            this.logger.debug(`Removed content from ${this._label}`);
        } else {
            const sizeDiff = newContent.length - (this._content[index]?.length || 0);
            if (sizeDiff > 0) {
                this.checkMemoryLimitOrThrow(sizeDiff);
            }
            this._content[index] = newContent;
            this.logger.debug(`Replaced content in ${this._label}`);
        }
        this.lastModifiedInMemory = new Date();
        await this.persistToStoreAndFile();
    }

    public async clear(): Promise<void> {
        this._content = [];
        this.lastModifiedInMemory = new Date();
        await this.persistToStoreAndFile();
        this.logger.info(`Cleared ${this._label}`);
    }

    public async render(): Promise<string> {
        // Content for system prompt
        return this._content.join("\n"); // Simpler render for direct inclusion
        // Or keep the tagged version if preferred for parsing by PromptService:
        // return [
        //     `<${this._label} characters="${this.currentSize}/${this._limit}">`,
        //     ...this._content,
        //     `</${this._label}>`
        // ].join('\n');
    }

    private checkMemoryLimitOrThrow(additionalContentLength: number): void {
        if (this.currentSize + additionalContentLength > this._limit) {
            const errorMsg = `Memory limit exceeded for ${this._label}. Current: ${this.currentSize}, Adding: ${additionalContentLength}, Limit: ${this._limit}`;
            this.logger.warn(errorMsg);
            throw new MemoryError(errorMsg, {
                currentSize: this.currentSize,
                contentLength: additionalContentLength,
                limit: this._limit,
                label: this._label,
            });
        }
    }

    private async persistToStoreAndFile(): Promise<void> {
        try {
            await this.store.save({
                id: this._id,
                label: this._label,
                content: this._content,
                limit: this._limit,
            });
            if (this.filePath) {
                await this.saveToFileInternal(this._content);
            }
            this.logger.debug(`Persisted ${this.label} to store and file (if bound).`);
        } catch (error) {
            this.logger.error(`Failed to persist ${this._label}: ${error.message}`);
            throw new MemoryError(`Persistence failed for ${this.label}`, { error });
        }
    }

    public async reloadFromStore(): Promise<void> {
        try {
            const data = await this.store.load(this._id, this._label);
            if (data) {
                this._content = Array.isArray(data.content) ? [...data.content] : [];
                this._limit = data.limit;
                this.lastModifiedInMemory = new Date();
                this.logger.debug(`${this._label} reloaded from store.`);
                if (this.filePath) {
                    await this.saveToFileInternal(this._content);
                }
            } else {
                this.logger.warn(`${this._label} (ID: ${this._id}) not found in store during reload. Memory content unchanged.`);
            }
        } catch (error) {
            this.logger.error(`Failed to reload ${this._label} from store: ${error.message}`);
            throw new MemoryError(`Reload from store failed for ${this.label}`, { error });
        }
    }

    public async bindFile(filePath: string): Promise<void> {
        this.filePath = path.resolve(filePath);
        this.logger.info(`Binding ${this._label} to file: ${this.filePath}`);
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                await mkdir(dir, { recursive: true });
                this.logger.info(`Created directory for file: ${dir}`);
            }
            let fileContent: string[] | null = null;
            if (fs.existsSync(this.filePath)) {
                fileContent = await this.loadFromFileInternal();
                this.logger.debug(`Loaded content from existing file ${this.filePath} during binding.`);
            } else {
                await this.saveToFileInternal(this._content);
                this.logger.info(`Created new file ${this.filePath} with current memory content.`);
            }
            if (fileContent !== null) {
                this._content = fileContent;
                this.lastModifiedInMemory = new Date();
                await this.store.save({ id: this.id, label: this.label, content: this._content, limit: this.limit });
                this.logger.info(`Synced ${this.label} from file ${this.filePath} to memory and primary store after binding.`);
            }
            await this.startWatching();
            this.ctx.on("dispose", () => this.disposeFileWatcher());
            this.logger.info(`${this._label} successfully bound to file: ${this.filePath}`);
        } catch (error) {
            this.filePath = undefined;
            this.logger.error(`Failed to bind ${this._label} to file ${filePath}: ${error.message}`);
            throw new MemoryError(`File binding failed for ${this.label}`, { filePath, error });
        }
    }

    private async loadFromFileInternal(): Promise<string[]> {
        if (!this.filePath) return [];
        try {
            const content = await readFile(this.filePath, "utf-8");
            return content.split(/\r?\n/);
        } catch (error) {
            if (error.code === "ENOENT") {
                this.logger.warn(`File not found during load: ${this.filePath}. Returning empty.`);
                return [];
            }
            this.logger.error(`Failed to load from file ${this.filePath}: ${error.message}`);
            throw new MemoryError(`Load from file failed for ${this.filePath}`, { error });
        }
    }

    private async saveToFileInternal(contentToSave: string[]): Promise<void> {
        if (!this.filePath) return;
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                await mkdir(dir, { recursive: true });
            }
            await writeFile(this.filePath, contentToSave.join("\n"), "utf-8");
            const fstat = await stat(this.filePath);
            this.lastModifiedFileMs = fstat.mtimeMs;
            this.logger.debug(`Saved ${this._label} to file: ${this.filePath}`);
        } catch (error) {
            this.logger.error(`Failed to save to file ${this.filePath}: ${error.message}`);
            throw new MemoryError(`Save to file failed for ${this.filePath}`, { error });
        }
    }

    private async syncFromFileToMemoryAndStore(): Promise<void> {
        if (!this.filePath) return;
        this.logger.info(`File watcher: Syncing from ${this.filePath} to ${this._label}`);
        try {
            const fileContent = await this.loadFromFileInternal();
            this._content = fileContent;
            this.lastModifiedInMemory = new Date();
            await this.store.save({
                id: this._id,
                label: this._label,
                content: this._content,
                limit: this._limit,
            });
            this.logger.debug(`${this._label} synced from file to memory and primary store.`);
        } catch (error) {
            this.logger.error(`File watcher: Error syncing from ${this.filePath} for ${this._label}: ${error.message}`);
        }
    }

    private async startWatching(): Promise<void> {
        if (!this.filePath || this.watcher) return;
        try {
            if (!fs.existsSync(this.filePath)) {
                await this.saveToFileInternal(this._content);
                this.logger.warn(`[File Watcher] Watched file ${this.filePath} was missing, recreated it.`);
            }
            const fstat = await stat(this.filePath);
            this.lastModifiedFileMs = fstat.mtimeMs;
            this.logger.info(`[File Watcher] Starting watch on: ${this.filePath} for ${this._label}`);
            this.watcher = fs.watch(this.filePath, async (eventType) => {
                if (this.debounceTimer) clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(async () => {
                    try {
                        if (!this.filePath || !fs.existsSync(this.filePath)) {
                            this.logger.warn(`[File Watcher] File ${this.filePath} for ${this.label} no longer exists. Stopping watcher.`);
                            await this.stopWatching();
                            return;
                        }
                        const currentFstat = await stat(this.filePath);
                        if (currentFstat.mtimeMs > this.lastModifiedFileMs) {
                            this.logger.info(`[File Watcher] File ${this.filePath} changed. Syncing ${this._label}.`);
                            this.lastModifiedFileMs = currentFstat.mtimeMs;
                            await this.syncFromFileToMemoryAndStore();
                        }
                    } catch (error) {
                        this.logger.error(
                            `[File Watcher] Error processing file change for ${this.filePath} (${this._label}): ${error.message}`
                        );
                    } finally {
                        this.debounceTimer = undefined;
                    }
                }, 300);
            });
            this.watcher.on("error", async (err) => {
                this.logger.error(`[File Watcher] Watcher error for ${this.filePath} (${this.label}): ${err.message}`);
                await this.stopWatching();
            });
        } catch (error) {
            this.logger.error(`[File Watcher] Failed to start watching ${this.filePath} for ${this._label}: ${error.message}`);
        }
    }

    private async stopWatching(): Promise<void> {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = undefined;
            this.logger.info(`[File Watcher] Stopped watching ${this.filePath} for ${this._label}`);
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
    }

    public async disposeFileWatcher(): Promise<void> {
        this.logger.debug(`Disposing file watcher for ${this._label}`);
        await this.stopWatching();
    }

    static async getOrCreate(
        ctx: Context,
        identifier: { label: string; id?: string }, // Label is required for lookup/creation logic
        config: {
            defaultLimit?: number;
            initialValue?: string[];
            store?: IMemoryBlockStore;
            filePathToBind?: string;
        } = {}
    ): Promise<MemoryBlock> {
        const logger = ctx.logger(MemoryBlock.name);
        const { label: blockLabel, id: providedId } = identifier;
        let blockId = providedId;

        const effectiveStore = config.store || new DatabaseMemoryBlockStore(ctx);
        const defaultLimit = config.defaultLimit ?? 5000;
        const initialValue = config.initialValue ?? [];

        try {
            let loadedData: MemoryBlockData | null = null;
            if (blockId) {
                loadedData = await effectiveStore.load(blockId, blockLabel);
            } else {
                // No ID provided, try to find by unique label
                const resultsByLabel = await ctx.database.get(MEMORY_TABLE, { label: blockLabel });
                if (resultsByLabel && resultsByLabel.length > 0) {
                    const dbEntry = resultsByLabel[0]; // Assuming label is unique or we take the first
                    loadedData = { id: dbEntry.id, label: dbEntry.label, content: dbEntry.content, limit: dbEntry.limit };
                    blockId = dbEntry.id; // Use ID from database
                    logger.debug(`Found existing block by label "${blockLabel}" with ID "${blockId}".`);
                }
            }

            if (loadedData) {
                logger.debug(`Loaded existing MemoryBlock: ${loadedData.label} (ID: ${loadedData.id}) from store.`);
                return new MemoryBlock(ctx, loadedData, effectiveStore, config.filePathToBind);
            }

            if (!blockId) {
                blockId = `block-${blockLabel}-${Date.now()}-${Math.random().toString(36).substring(2)}`;
            }
            logger.info(`Creating new MemoryBlock: ${blockLabel} (ID: ${blockId})`);
            const newBlockData: MemoryBlockData = { id: blockId, label: blockLabel, content: initialValue, limit: defaultLimit };
            await effectiveStore.save(newBlockData);
            return new MemoryBlock(ctx, newBlockData, effectiveStore, config.filePathToBind);
        } catch (error) {
            logger.error(`GetOrCreate failed for ${blockLabel}: ${error.message}`);
            throw new MemoryError(`GetOrCreate failed for ${blockLabel}`, { identifier, error });
        }
    }
}

export const defaultCompressionPrompt = `记忆压缩汇总的基本原则与要求

1. 人物核心特征优先
   - 保留每个人的身份、特长、性格、重要习惯，去掉重复或琐碎的行为记录（如某次聊天内容）。
   - 示例：
      - ✅ 保留 "小软酱是化学博士，开发AnyChem，数学物理全能，性格傲娇"
      - ❌ 删除 "今天和小软酱玩化学游戏，她纠正了我"（非核心特征）
2. 合并同类信息
   - 同一人物的多个属性尽量合并为一句，避免分散。
   - 示例：
      - 原句：
         - "马克柴喜欢语文、数学、英语和计算机"
         - "马克柴喜欢二次元文化，玩过东方Project"
      - 合并为：
         - "马克柴擅长文科理科，爱好二次元（东方Project）"
3. 时间敏感性信息简化
   - 具体日期/事件（如考试时间）若无长期意义，可模糊化或删除。
   - 示例：
      - ❌ "2025年5月28日数学周测" → ✅ "马克柴近期有数学考试焦虑"
4. 群体行为与互动精简
   - 群聊中的临时互动（如"今天群里讨论XX"）若无特殊意义，直接删除。
   - 保留长期关系（如"群小草是赞助商"）或标志性事件（如"茴香豆称我为骗子"）。
5. 避免主观评价
   - 删除纯情绪表达（如"很讨厌""让我生气"），除非反映人物性格（如"AAA气泡鱼在意被遗忘"）。
6. 标准化表述
   - 统一称呼（如全用"马克柴"或全用"mkc"），避免混用。
   - 用简洁句式（如"人物A是XX，擅长YY，性格ZZ"）。

压缩后依然保持每行一条记忆，每一条记忆是一个完整的句子。`;
