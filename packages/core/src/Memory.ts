import fs from "fs";
import { readFile, stat, writeFile } from "fs/promises";
import { Context } from "koishi";
import path from "path";

import { Scenario } from "./Scenario";
import { MEMORY_TABLE } from "./types/model";
import { isEmpty } from "./utils/string";

interface MemoryBlockData {
    id: string;
    label: string;
    value: string[];
    limit: number;
}

class MemoryError extends Error {
    constructor(message: string, public readonly context?: Record<string, unknown>) {
        super(message);
        this.name = 'MemoryError';
    }
}

/**
 * 记忆管理器 - 负责管理核心记忆、回忆记忆和档案记忆
 */
export class Memory {
    private coreMemory: Map<string, MemoryBlock> = new Map();
    private recallMemory: Scenario[] = [];
    private archivalMemory: MemoryBlock[] = [];
    private lastModified: Date = new Date();

    private static instance: Memory;

    /**
     * 获取单例实例
     */
    static getInstance(ctx: Context): Memory {
        if (!Memory.instance) {
            Memory.instance = new Memory(ctx);
        }
        return Memory.instance;
    }

    constructor(private readonly ctx: Context) {
        this.ctx.logger.info('记忆管理器已初始化');
    }

    /**
     * 获取指定标签的记忆块
     */
    private getMemoryBlock(label: string): MemoryBlock {
        const memoryBlock = this.coreMemory.get(label);
        if (!memoryBlock) {
            throw new MemoryError("未找到指定的记忆块", {
                label,
                availableLabels: Array.from(this.coreMemory.keys())
            });
        }
        return memoryBlock;
    }

    /**
     * 添加记忆块到核心记忆
     */
    public addMemoryBlock(label: string, mb: MemoryBlock): void {
        this.coreMemory.set(label, mb);
        this.ctx.logger.debug(`已添加记忆块: ${label}`);
    }

    /**
     * 向核心记忆追加内容
     * @param label 要编辑的记忆部分标签（如 persona 或 human）
     * @param content 要写入记忆的内容
     */
    async appendCoreMemory(label: string, content: string): Promise<string> {
        try {
            const memoryBlock = this.getMemoryBlock(label);
            await memoryBlock.append(content);
            this.lastModified = new Date();
            this.ctx.logger.info(`成功向核心记忆追加内容: ${label}`);
            return `记忆追加成功。新内容: ${content}`;
        } catch (error) {
            this.ctx.logger.error(`追加核心记忆失败: ${error.message}`);
            throw new MemoryError(`追加核心记忆失败: ${error.message}`, { label, content });
        }
    }

    /**
     * 替换核心记忆的内容。
     * @param label 要编辑的记忆部分标签（如 persona 或 human）
     * @param old_content 要替换的字符串，必须完全匹配
     * @param new_content 要写入记忆的新内容
     */
    async replaceCoreMemory(label: string, old_content: string, new_content: string): Promise<string> {
        try {
            const memoryBlock = this.getMemoryBlock(label);
            await memoryBlock.replace(old_content, new_content);
            this.lastModified = new Date();
            this.ctx.logger.info(`成功替换核心记忆: ${label}`);
            return `记忆替换成功。新内容: ${new_content}`;
        } catch (error) {
            this.ctx.logger.error(`替换核心记忆失败: ${error.message}`);
            throw new MemoryError(`替换核心记忆失败: ${error.message}`, {
                label,
                old_content,
                new_content
            });
        }
    }

    /**
     * 插入档案记忆
     * @param content 要存储的内容
     */
    async insertArchivalMemory(content: string): Promise<string> {
        try {
            const memoryBlock = new MemoryBlock(
                this.ctx,
                `archival-${Date.now()}-${Math.random().toString(36).substring(2)}`,
                'archival',
                5000,
                [content]
            );
            this.archivalMemory.push(memoryBlock);
            this.lastModified = new Date();
            this.ctx.logger.info(`成功插入档案记忆，内容长度: ${content.length}`);
            return `档案记忆插入成功。新内容: ${content}`;
        } catch (error) {
            this.ctx.logger.error(`插入档案记忆失败: ${error.message}`);
            throw new MemoryError(`插入档案记忆失败: ${error.message}`, { content });
        }
    }

    /**
     * 搜索档案记忆
     * @param query 搜索查询
     * @param page 页码
     * @param start 起始位置
     */
    async searchArchivalMemory(query: string, page: number = 1, start: number = 0): Promise<string> {
        try {
            const pageSize = 10;
            const offset = (page - 1) * pageSize + start;

            // 简单的文本搜索实现
            const matchedMemories = this.archivalMemory.filter(memory => {
                return memory.value.some(item =>
                    item.toLowerCase().includes(query.toLowerCase())
                );
            });

            const results = matchedMemories.slice(offset, offset + pageSize);

            if (results.length === 0) {
                return `未找到包含 "${query}" 的档案记忆。`;
            }

            const resultStrings = await Promise.all(
                results.map((memory, index) =>
                    memory.render().then(rendered => `结果 ${offset + index + 1}:\n${rendered}`)
                )
            );

            this.ctx.logger.info(`档案记忆搜索完成: 查询="${query}", 找到${matchedMemories.length}个结果`);

            return [
                `档案记忆搜索结果 (查询: "${query}")`,
                `第 ${page} 页，共找到 ${matchedMemories.length} 个结果:`,
                '',
                ...resultStrings
            ].join('\n');
        } catch (error) {
            this.ctx.logger.error(`搜索档案记忆失败: ${error.message}`);
            throw new MemoryError(`搜索档案记忆失败: ${error.message}`, { query, page, start });
        }
    }

    /**
     * 渲染完整的记忆状态
     */
    async render(): Promise<string> {
        try {
            const coreMemoryBlocks = await Promise.all(
                Array.from(this.coreMemory.values()).map(block => block.render())
            );

            const result = [
                `### Memory [last modified: ${this.lastModified.toLocaleString()}]`,
                `${this.archivalMemory.length} total memories you created are stored in archival memory (use functions to access them)`,
                '',
                'Core memory shown below (limited in size, additional information stored in archival / recall memory):',
                '',
                ...coreMemoryBlocks
            ].join('\n');
            return result;
        } catch (error) {
            this.ctx.logger.error(`渲染记忆失败: ${error.message}`);
            throw new MemoryError(`渲染记忆失败: ${error.message}`);
        }
    }

    /**
     * 清理资源
     */
    async dispose(): Promise<void> {
        try {
            await Promise.all([
                ...Array.from(this.coreMemory.values()).map(block => block.dispose()),
                ...this.archivalMemory.map(block => block.dispose())
            ]);

            this.coreMemory.clear();
            this.archivalMemory.length = 0;
            this.recallMemory.length = 0;

        } catch (error) {
            this.ctx.logger.error(`清理记忆管理器资源失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取内存统计信息
     */
    async getStats(): Promise<{
        coreMemoryCount: number;
        archivalMemoryCount: number;
        recallMemoryCount: number;
        totalSize: number;
    }> {
        const coreSizes = await Promise.all(
            Array.from(this.coreMemory.values()).map(block => block.size())
        );
        const archivalSizes = await Promise.all(
            this.archivalMemory.map(block => block.size())
        );

        return {
            coreMemoryCount: this.coreMemory.size,
            archivalMemoryCount: this.archivalMemory.length,
            recallMemoryCount: this.recallMemory.length,
            totalSize: coreSizes.reduce((a, b) => a + b, 0) + archivalSizes.reduce((a, b) => a + b, 0)
        };
    }
}

/**
 * 记忆块 - 管理单个记忆块的数据和文件绑定
 */
export class MemoryBlock {
    private readonly ctx: Context;
    private filePath?: string;
    private watcher?: fs.FSWatcher;
    private debounceTimer?: NodeJS.Timeout;
    private lastModified = 0;
    private _value?: string[]; // 缓存值

    constructor(
        ctx: Context,
        public readonly id: string,
        public readonly label: string,
        public readonly limit = 5000,
        public readonly value: string[] = [],
    ) {
        this.ctx = ctx;
        this._value = [...value]; // 初始化缓存
        this.ctx.logger.debug(`创建记忆: ${label} (${id})`);
    }

    /**
     * 获取或创建记忆块
     * @param ctx Koishi 上下文
     * @param identifier 标识符，可以是字符串标签或包含 id/label 的对象
     */
    static async getOrCreate(
        ctx: Context,
        identifier: string | { id?: string; label?: string }
    ): Promise<MemoryBlock> {
        const condition = typeof identifier === 'string'
            ? { label: identifier }
            : identifier;

        try {
            const [result] = await ctx.database.get(MEMORY_TABLE, condition);
            if (result) {
                ctx.logger.debug(`找到现有记忆: ${result.label}`);
                return new MemoryBlock(ctx, result.id, result.label, result.limit, result.value);
            }

            if (typeof identifier !== 'string') {
                throw new MemoryError('未找到记忆且无法在没有标签的情况下创建');
            }

            const id = `block-${Date.now()}-${Math.random().toString(36).substring(2)}`;
            await ctx.database.create(MEMORY_TABLE, {
                id,
                label: identifier,
                value: [],
                limit: 5000
            });

            ctx.logger.info(`创建新记忆: ${identifier} (${id})`);
            return new MemoryBlock(ctx, id, identifier);
        } catch (error) {
            ctx.logger.error(`获取或创建记忆失败: ${error.message}`);
            throw new MemoryError(`获取或创建记忆失败: ${error.message}`, { identifier });
        }
    }

    /**
     * 开始监视文件变化
     */
    private async startWatching(): Promise<void> {
        if (!this.filePath) return;

        await this.stopWatching();

        try {
            const fstat = await stat(this.filePath);
            this.lastModified = fstat.mtimeMs;
        } catch {
            this.lastModified = 0;
        }

        this.ctx.logger.info(`[文件监视器] 开始监听文件变动 ${this.filePath}`);

        this.watcher = fs.watch(this.filePath, async (eventType) => {
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            this.debounceTimer = setTimeout(async () => {
                try {
                    if (eventType === 'change') {
                        const fstat = await stat(this.filePath!);
                        if (fstat.mtimeMs > this.lastModified) {
                            this.ctx.logger.info(`[文件监视器] 文件 ${this.filePath} 已被修改，正在同步到记忆`);
                            this.lastModified = fstat.mtimeMs;
                            await this.syncFromFile();
                        }
                    }
                } catch (error) {
                    this.ctx.logger.error(`[文件监视器] 处理文件变化时出错: ${error.message}`);
                }
            }, 300);
        });
    }

    /**
     * 停止监视文件
     */
    private async stopWatching(): Promise<void> {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = undefined;
            this.ctx.logger.debug('[文件监视器] 已停止文件监视');
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
    }

    /**
     * 从文件同步数据到数据库
     */
    private async syncFromFile(): Promise<void> {
        try {
            const fileContent = await this.loadFromFile();
            await this.ctx.database.upsert(MEMORY_TABLE, [{
                id: this.id,
                label: this.label,
                value: fileContent,
                limit: this.limit
            }]);
            this._value = fileContent; // 更新缓存
            this.ctx.logger.debug(`已从文件同步数据到记忆: ${this.label}`);
        } catch (error) {
            this.ctx.logger.error(`从文件同步失败: ${error.message}`);
            throw new MemoryError(`从文件同步失败: ${error.message}`, { filePath: this.filePath });
        }
    }

    /**
     * 绑定文件到记忆块
     * @param filePath 文件路径
     */
    async bindFile(filePath: string): Promise<void> {
        try {
            this.filePath = filePath;

            // 确保目录存在
            if (!fs.existsSync(filePath)) {
                await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
                await writeFile(filePath, '');
                this.ctx.logger.info(`创建新文件: ${filePath}`);
            }

            const value = await readFile(filePath, 'utf-8');
            const lines = value.split('\n').filter(line => line.trim());

            await this.ctx.database.upsert(MEMORY_TABLE, [{
                id: this.id,
                label: this.label,
                value: lines,
                limit: this.limit
            }]);

            await this.syncFromFile();
            await this.startWatching();

            // 注册清理回调
            this.ctx.on("dispose", () => this.dispose());

            this.ctx.logger.info(`成功绑定文件到记忆: ${this.label} -> ${filePath}`);
        } catch (error) {
            this.ctx.logger.error(`绑定文件失败: ${error.message}`);
            throw new MemoryError(`绑定文件失败: ${error.message}`, { filePath });
        }
    }

    /**
     * 清理资源
     */
    async dispose(): Promise<void> {
        this.ctx.logger.info(`[文件监视器] 正在清理记忆块资源: ${this.label}`);
        await this.stopWatching();
        this._value = undefined;
    }

    /**
     * 从文件加载内容
     */
    private async loadFromFile(): Promise<string[]> {
        if (!this.filePath) return [];
        try {
            const content = await readFile(this.filePath, 'utf-8');
            return content.split('\n').filter(line => line.trim());
        } catch (error) {
            this.ctx.logger.warn(`从文件加载失败 ${this.filePath}: ${error.message}`);
            return [];
        }
    }

    /**
     * 保存内容到文件
     */
    private async saveToFile(value: string[]): Promise<void> {
        if (!this.filePath) return;
        try {
            await writeFile(this.filePath, value.join('\n'));
            this.ctx.logger.debug(`已保存内容到文件: ${this.filePath}`);
        } catch (error) {
            this.ctx.logger.error(`保存到文件失败: ${error.message}`);
            throw new MemoryError(`保存到文件失败: ${error.message}`, { filePath: this.filePath });
        }
    }

    /**
     * 获取记忆块数据
     */
    private async getValue(): Promise<MemoryBlockData> {
        // 使用缓存避免频繁数据库查询
        if (this._value) {
            return {
                id: this.id,
                label: this.label,
                value: this._value,
                limit: this.limit
            };
        }

        try {
            const [result] = await this.ctx.database.get(MEMORY_TABLE, {
                id: this.id,
                label: this.label,
            });

            const data = result || {
                id: this.id,
                label: this.label,
                value: [],
                limit: this.limit
            };

            this._value = data.value; // 缓存结果
            return data;
        } catch (error) {
            this.ctx.logger.error(`获取记忆块数据失败: ${error.message}`);
            throw new MemoryError(`获取记忆块数据失败: ${error.message}`, { id: this.id, label: this.label });
        }
    }

    /**
     * 获取记忆块大小（字符数）
     */
    async size(): Promise<number> {
        const { value } = await this.getValue();
        return value.reduce((sum, item) => sum + item.length, 0);
    }

    /**
     * 检查内存限制
     */
    private async checkMemoryLimit(additionalContentLength: number): Promise<void> {
        const currentSize = await this.size();
        if (currentSize + additionalContentLength > this.limit) {
            const error = `内存限制已超出，当前大小: ${currentSize}, 尝试添加: ${additionalContentLength}, 限制: ${this.limit}`;
            this.ctx.logger.warn(error);
            throw new MemoryError("内存限制已超出", {
                currentSize,
                contentLength: additionalContentLength,
                limit: this.limit,
                label: this.label
            });
        }
    }

    /**
     * 追加内容到记忆块
     */
    async append(content: string): Promise<void> {
        await this.checkMemoryLimit(content.length);

        const { value } = await this.getValue();
        value.push(content);

        // 先保存到文件，再更新数据库
        if (this.filePath) {
            await this.saveToFile(value);
        }

        await this.ctx.database.set(MEMORY_TABLE, { id: this.id, label: this.label }, { value });
        this._value = value; // 更新缓存

        this.ctx.logger.debug(`已追加内容到记忆块 ${this.label}, 新大小: ${await this.size()}`);
    }

    /**
     * 替换记忆块中的内容
     */
    async replace(old_content: string, new_content: string): Promise<void> {
        const { value } = await this.getValue();
        const index = value.findIndex((item) => item === old_content);

        if (index === -1) {
            throw new MemoryError("未找到要替换的内存内容", { old_content, label: this.label });
        }

        if (isEmpty(new_content)) {
            // 删除内容
            value.splice(index, 1);
            this.ctx.logger.debug(`已从记忆块 ${this.label} 删除内容`);
        } else {
            // 替换内容
            const sizeDiff = new_content.length - (value[index]?.length || 0);
            if (sizeDiff > 0) {
                await this.checkMemoryLimit(sizeDiff);
            }
            value[index] = new_content;
            this.ctx.logger.debug(`已替换记忆块 ${this.label} 中的内容`);
        }

        // 先保存到文件，再更新数据库
        if (this.filePath) {
            await this.saveToFile(value);
        }

        await this.ctx.database.upsert(MEMORY_TABLE, [{
            id: this.id,
            label: this.label,
            value,
            limit: this.limit
        }]);

        this._value = value; // 更新缓存
    }

    /**
     * 渲染记忆块内容
     */
    async render(): Promise<string> {
        const { value } = await this.getValue();
        const currentSize = await this.size();
        return [
            `<${this.label} characters="${currentSize}/${this.limit}">`,
            ...value,
            `</${this.label}>`
        ].join('\n');
    }

    /**
     * 清空记忆块内容
     */
    async clear(): Promise<void> {
        const emptyValue: string[] = [];

        if (this.filePath) {
            await this.saveToFile(emptyValue);
        }

        await this.ctx.database.set(MEMORY_TABLE, { id: this.id, label: this.label }, { value: emptyValue });
        this._value = emptyValue;

        this.ctx.logger.info(`已清空记忆块: ${this.label}`);
    }
}
