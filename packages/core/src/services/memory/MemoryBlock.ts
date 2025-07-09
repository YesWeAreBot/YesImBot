import fs from "fs";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { Context, Logger } from "koishi";
import path from "path";

import { AppError, ErrorCodes, isEmpty, truncate } from "../../shared";
import { DatabaseMemoryBlockStore, IMemoryBlockStore } from "./DatabaseMemoryBlockStore";

import { Services } from "../types";
import { MEMORY_TABLE } from "./config";
import { MemoryBlockData } from "./types";

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
        this.logger = ctx[Services.Logger].getLogger(`[记忆块] [${data.label}]`);
        this._id = data.id;
        this._label = data.label;
        this._limit = data.limit;
        this._content = Array.isArray(data.content) ? [...data.content] : [];

        if (filePathToBind) {
            this.bindFile(filePathToBind).catch((err) => {
                // 错误日志保持详细
                this.logger.error(`初始化时绑定文件失败 | 错误: ${err.message}`);
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
        this.logger.debug(`追加内容 | 内容: "${truncate(content)}"`);
    }

    public async replace(oldContent: string, newContent: string): Promise<void> {
        const index = this._content.findIndex((item) => item === oldContent);
        if (index === -1) {
            throw new AppError(`Content to replace not found in ${this._label}`, {
                code: ErrorCodes.RESOURCE.NOT_FOUND,
                context: { resourceType: "MemoryBlock", resourceId: this._label, content: oldContent },
            });
        }

        if (isEmpty(newContent)) {
            this._content.splice(index, 1);
            this.logger.debug(`删除内容 | 内容: "${truncate(oldContent)}"`);
        } else {
            const sizeDiff = newContent.length - (this._content[index]?.length || 0);
            if (sizeDiff > 0) {
                this.checkMemoryLimitOrThrow(sizeDiff);
            }
            this._content[index] = newContent;
            this.logger.debug(`替换内容 | 旧: "${truncate(oldContent)}" -> 新: "${truncate(newContent)}"`);
        }
        this.lastModifiedInMemory = new Date();
        await this.persistToStoreAndFile();
    }

    public async clear(): Promise<void> {
        this._content = [];
        this.lastModifiedInMemory = new Date();
        await this.persistToStoreAndFile();
        this.logger.debug(`记忆块已清空`);
    }

    private checkMemoryLimitOrThrow(additionalContentLength: number): void {
        if (this.currentSize + additionalContentLength > this._limit) {
            const errorMsg = `超出容量限制 | 当前: ${this.currentSize}, 新增: ${additionalContentLength}, 限制: ${this._limit}`;
            this.logger.warn(errorMsg);
            throw new AppError(errorMsg, {
                code: ErrorCodes.RESOURCE.LIMIT_EXCEEDED,
                context: { currentSize: this.currentSize, contentLength: additionalContentLength, limit: this._limit, label: this._label },
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
            this.logger.debug(`持久化 | 已保存至 ${this.filePath ? "数据库和文件" : "数据库"}`);
        } catch (error) {
            this.logger.error(`持久化 | 保存失败: ${error.message}`);
            throw new AppError(`Persistence failed for ${this.label}`, {
                code: ErrorCodes.RESOURCE.STORAGE_FAILURE,
                context: { label: this._label },
                cause: error,
            });
        }
    }

    public async bindFile(filePath: string): Promise<void> {
        this.filePath = path.resolve(filePath);
        this.logger.debug(`绑定文件 | 路径: ${this.filePath}`);
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                await mkdir(dir, { recursive: true });
                this.logger.debug(`绑定文件 | 创建目录: ${dir}`);
            }
            let fileContent: string[] | null = null;
            if (fs.existsSync(this.filePath)) {
                fileContent = await this.loadFromFileInternal();
                this.logger.debug(`绑定文件 | 从现有文件中加载内容`);
            } else {
                await this.saveToFileInternal(this._content);
                this.logger.debug(`绑定文件 | 创建并写入新文件`);
            }
            if (fileContent !== null) {
                this._content = fileContent;
                this.lastModifiedInMemory = new Date();
                await this.store.save({ id: this.id, label: this.label, content: this._content, limit: this.limit });
                this.logger.debug(`同步 | 文件内容已覆盖内存和数据库`);
            }
            await this.startWatching();
            this.ctx.on("dispose", () => this.disposeFileWatcher());
            this.logger.debug(`绑定文件 | 成功`);
        } catch (error) {
            this.filePath = undefined;
            this.logger.error(`绑定文件 | 失败: ${error.message} | 路径: ${filePath}`);
            throw new AppError(`File binding failed for ${this.label}`, {
                code: ErrorCodes.RESOURCE.STORAGE_FAILURE,
                context: { label: this._label, filePath },
                cause: error,
            });
        }
    }

    private async loadFromFileInternal(): Promise<string[]> {
        if (!this.filePath) return [];
        try {
            const content = await readFile(this.filePath, "utf-8");
            return content.split(/\r?\n/);
        } catch (error) {
            if (error.code === "ENOENT") {
                this.logger.warn(`加载文件 | 文件不存在，返回空内容 | 路径: ${this.filePath}`);
                return [];
            }
            this.logger.error(`加载文件 | 读取失败: ${error.message} | 路径: ${this.filePath}`);
            throw new AppError(`Load from file failed for ${this.filePath}`, {
                code: ErrorCodes.RESOURCE.STORAGE_FAILURE,
                context: { label: this._label, filePath: this.filePath },
                cause: error,
            });
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
            this.logger.debug(`保存文件 | 成功 | 路径: ${this.filePath}`);
        } catch (error) {
            this.logger.error(`保存文件 | 写入失败: ${error.message} | 路径: ${this.filePath}`);
            throw new AppError(`Save to file failed for ${this.filePath}`, {
                code: ErrorCodes.RESOURCE.STORAGE_FAILURE,
                context: { label: this._label, filePath: this.filePath },
                cause: error,
            });
        }
    }

    private async syncFromFileToMemoryAndStore(): Promise<void> {
        if (!this.filePath) return;
        this.logger.debug(`[文件同步] 开始 | 文件 -> 内存 & 数据库`);
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
            this.logger.debug(`[文件同步] 成功`);
        } catch (error) {
            this.logger.error(`[文件同步] 失败 | 错误: ${error.message}`);
        }
    }

    private async startWatching(): Promise<void> {
        if (!this.filePath || this.watcher) return;
        try {
            if (!fs.existsSync(this.filePath)) {
                await this.saveToFileInternal(this._content);
                this.logger.warn(`[文件监视] 文件丢失，已重新创建 | 路径: ${this.filePath}`);
            }
            const fstat = await stat(this.filePath);
            this.lastModifiedFileMs = fstat.mtimeMs;
            this.logger.debug(`[文件监视] 启动 | 路径: ${this.filePath}`);
            this.watcher = fs.watch(this.filePath, async (eventType) => {
                if (this.debounceTimer) clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(async () => {
                    try {
                        if (!this.filePath || !fs.existsSync(this.filePath)) {
                            this.logger.warn(`[文件监视] 文件已删除，停止监视 | 路径: ${this.filePath ?? "N/A"}`);
                            await this.stopWatching();
                            return;
                        }
                        const currentFstat = await stat(this.filePath);
                        if (currentFstat.mtimeMs > this.lastModifiedFileMs) {
                            this.logger.debug(`[文件监视] 文件变更，开始同步 | 路径: ${this.filePath}`);
                            this.lastModifiedFileMs = currentFstat.mtimeMs;
                            await this.syncFromFileToMemoryAndStore();
                        }
                    } catch (error) {
                        this.logger.error(`[文件监视] 处理变更时出错 | 错误: ${error.message}`);
                    } finally {
                        this.debounceTimer = undefined;
                    }
                }, 300);
            });
            this.watcher.on("error", async (err) => {
                this.logger.error(`[文件监视] 出现严重错误，已停止 | 错误: ${err.message}`);
                await this.stopWatching();
            });
        } catch (error) {
            this.logger.error(`[文件监视] 启动失败 | 错误: ${error.message}`);
        }
    }

    private async stopWatching(): Promise<void> {
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

    public async disposeFileWatcher(): Promise<void> {
        this.logger.debug(`[文件监视] 正在释放资源`);
        await this.stopWatching();
    }

    static async getOrCreate(
        ctx: Context,
        identifier: { label: string; id?: string },
        config: {
            defaultLimit?: number;
            initialValue?: string[];
            store?: IMemoryBlockStore;
            filePathToBind?: string;
        } = {}
    ): Promise<MemoryBlock> {
        // 静态方法使用一个通用的 logger
        const logger = ctx.logger("MemoryBlock");
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
                const resultsByLabel = await ctx.database.get(MEMORY_TABLE, { label: blockLabel });
                if (resultsByLabel && resultsByLabel.length > 0) {
                    const dbEntry = resultsByLabel[0];
                    loadedData = { id: dbEntry.id, label: dbEntry.label, content: dbEntry.content, limit: dbEntry.limit };
                    blockId = dbEntry.id;
                    logger.debug(`[GetOrCreate] 检索成功 | 标签: "${blockLabel}", ID: "${blockId}"`);
                }
            }

            if (loadedData) {
                logger.debug(`[GetOrCreate] 加载现有实例 | 标签: "${loadedData.label}", ID: "${loadedData.id}"`);
                return new MemoryBlock(ctx, loadedData, effectiveStore, config.filePathToBind);
            }

            if (!blockId) {
                blockId = `block-${blockLabel}-${Date.now()}-${Math.random().toString(36).substring(2)}`;
            }
            logger.debug(`[GetOrCreate] 创建新实例 | 标签: "${blockLabel}", ID: "${blockId}"`);
            const newBlockData: MemoryBlockData = { id: blockId, label: blockLabel, content: initialValue, limit: defaultLimit };
            await effectiveStore.save(newBlockData);
            return new MemoryBlock(ctx, newBlockData, effectiveStore, config.filePathToBind);
        } catch (error) {
            logger.error(`[GetOrCreate] 操作失败 | 标签: "${blockLabel}" | 错误: ${error.message}`);
            throw new AppError(`GetOrCreate failed for ${blockLabel}`, {
                code: ErrorCodes.RESOURCE.STORAGE_FAILURE,
                context: { label: blockLabel, id: blockId },
                cause: error,
            });
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
