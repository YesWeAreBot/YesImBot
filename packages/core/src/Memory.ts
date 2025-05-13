import fs from "fs";
import { readFile, stat, writeFile } from "fs/promises";
import { Context } from "koishi";
import path from "path";

import { Agent } from "./agent";
import { Scenario } from "./Scenario";
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
    }
}

export class Memory {
    // 记忆块列表
    coreMemory: Map<string, MemoryBlock>;
    recallMemory: Scenario[];
    archivalMemory: MemoryBlock[];
    // 最后修改时间
    lastModified: Date;

    static instance: Memory;
    static DATABASE_NAME = "yesimbot.agent.memory";
    static getInstance(ctx: Context): Memory {
        if (!Memory.instance) {
            Memory.instance = new Memory(ctx);
        }
        return Memory.instance;
    }

    constructor(private ctx: Context) {
        this.coreMemory = new Map();
        this.recallMemory = [];
        this.archivalMemory = [];
        this.lastModified = new Date();
    }

    private getMemoryBlock(label: string): MemoryBlock {
        const memoryBlock = this.coreMemory.get(label);
        if (!memoryBlock) {
            throw new MemoryError("Memory block not found", { label, availableLabels: this.coreMemory.keys() });
        }
        return memoryBlock;
    }

    /**
     * Append to the contents of core memory(core_memory_append).
     * @param label Section of the memory to be edited (persona or human).
     * @param content Content to write to the memory.
     */
    async appendCoreMemory(label: string, content: string) {
        const memoryBlock = this.getMemoryBlock(label);
        await memoryBlock.append(content);
        this.lastModified = new Date();
        return `Memory appended successfully. New content: ${content}`;
    }

    /**
     * Replace the contents of core memory. To delete memories, use an empty string for new_content(core_memory_replace).
     * @param label Section of the memory to be edited (persona or human).
     * @param old_content String to replace. Must be an exact match.
     * @param new_content Content to write to the memory.
     */
    async replaceCoreMemory(label: string, old_content: string, new_content: string) {
        const memoryBlock = this.getMemoryBlock(label);
        memoryBlock.replace(old_content, new_content);
        this.lastModified = new Date();
        return `Memory replaced successfully. New content: ${new_content}`;
    }

    /**
     * 渲染记忆
     * 
     * @example
     * ### Memory [last modified: 2024-12-16 12:48:37 PM 中国标准时间+0800]
     * 4 previous messages between you and the user are stored in recall memory (use functions to access them)
     * 2 total memories you created are stored in archival memory (use functions to access them)
     *
     * Core memory shown below (limited in size, additional information stored in archival / recall memory):
     * <persona characters="100/5000">
     * </persona>
     * <human characters="100/5000">
     * </human>
     */
    async render(): Promise<string> {
        return [
            `### Memory [last modified: ${this.lastModified.toLocaleString()}]`,
            `${this.archivalMemory.length} total memories you created are stored in archival memory (use functions to access them)`,
            '',
            'Core memory shown below (limited in size, additional information stored in archival / recall memory):',
            '',
            ...await Promise.all(Array.from(this.coreMemory.values()).map(async memoryBlock => await memoryBlock.render()))
        ].join('\n');
    }
}

export class MemoryBlock {
    static DATABASE_NAME = "yesimbot.agent.memory_block";
    // 记忆块ID
    readonly id: string;
    // 记忆块标签
    readonly label: string;
    // 记忆块内容
    readonly value: string[];
    // 长度限制
    readonly limit: number;

    private ctx: Context;
    private filePath?: string;

    private watcher?: fs.FSWatcher;
    private debounceTimer?: NodeJS.Timeout;

    private lastModified = 0;

    static async getOrCreate(ctx: Context, identifier: string | { id?: string; label?: string }): Promise<MemoryBlock> {
        const condition = typeof identifier === 'string'
            ? { label: identifier }
            : identifier;

        const [result] = await ctx.database.get("yesimbot.agent.memory_block", condition);
        if (result) return new MemoryBlock(ctx, result.id, result.label, result.limit);

        if (typeof identifier !== 'string') {
            throw new Error('Memory block not found');
        }

        const id = `block-${Math.random().toString(36).substring(2)}`;
        await ctx.database.create("yesimbot.agent.memory_block", {
            id,
            label: identifier,
            value: [],
            limit: 5000
        });
        return new MemoryBlock(ctx, id, identifier);
    }

    constructor(ctx: Context, id: string, label: string, limit = 5000) {
        this.ctx = ctx;
        this.id = id;
        this.label = label;
        this.limit = limit;
    }

    private async startWatching() {
        if (!this.filePath) return;

        await this.stopWatching();

        try {
            const fstat = await stat(this.filePath);
            this.lastModified = fstat.mtimeMs;
        } catch {
            this.lastModified = 0;
        }

        this.ctx.logger.info(`[FileWatcher] Watching file ${this.filePath}`);

        this.watcher = fs.watch(this.filePath, async (eventType) => {
            if (this.debounceTimer) clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(async () => {
                if (eventType === 'change') {
                    const fstat = await stat(this.filePath);
                    if (fstat.mtimeMs > this.lastModified) {
                        this.ctx.logger.info(`[FileWatcher] File ${this.filePath} has been modified. Syncing to memory block.`);
                        this.lastModified = fstat.mtimeMs;
                        await this.syncFromFile();
                    }
                }
            }, 300);
        });
    }

    private async stopWatching() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = undefined;
        }
    }

    private async syncFromFile() {
        const fileContent = await this.loadFromFile();
        await this.ctx.database.upsert("yesimbot.agent.memory_block", [{
            id: this.id,
            label: this.label,
            value: fileContent,
            limit: this.limit
        }]);
    }

    /**
     * 同步策略：
     * 1. 实例化后从本地文件加载内容，覆盖数据库
     * 2. 监听文件变化，同步到数据库
     * 3. 数据库内容变更，同步到文件
     * 
     * 只有通过 append、replace 方法修改内容，才会同步到文件（没人会直接修改数据库吧？）
     * 
     * 也许根本不需要数据库
     */
    async bindFile(filePath: string) {
        this.filePath = filePath;
        if (!fs.existsSync(filePath)) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            await writeFile(filePath, '');
        }
        const value = await readFile(filePath, 'utf-8');
        await this.ctx.database.upsert("yesimbot.agent.memory_block", [{
            id: this.id,
            label: this.label,
            value: value.split('\n').filter(line => line.trim()),
        }])

        await this.syncFromFile();
        await this.startWatching();
        this.ctx.on("dispose", async () => {
            await this.dispose();
        });
    }

    async dispose() {
        this.ctx.logger.info("[FileWatcher] Disposing")
        await this.stopWatching();
    }

    private async loadFromFile(): Promise<string[]> {
        if (!this.filePath) return [];
        try {
            const content = await readFile(this.filePath, 'utf-8');
            return content.split('\n').filter(line => line.trim());
        } catch {
            return [];
        }
    }

    private async saveToFile(value: string[]) {
        if (!this.filePath) return;
        await writeFile(this.filePath, value.join('\n'));
    }

    private async getValue(): Promise<MemoryBlockData> {
        const [result] = await this.ctx.database.get("yesimbot.agent.memory_block", {
            id: this.id,
            label: this.label,
        });
        return result || { id: this.id, label: this.label, value: [], limit: this.limit };
    }

    // 记忆块大小，以字符串长度计算
    async size(): Promise<number> {
        const { value } = await this.getValue();
        return value.reduce((sum, item) => sum + item.length, 0);
    }

    /**
     * 检查添加内容后是否超过长度限制
     * @param contentLength 
     */
    private async checkMemoryLimit(contentLength: number) {
        if (await this.size() + contentLength > this.limit) {
            throw new Error("Memory limit exceeded");
        }
    }

    async append(content: string) {
        await this.checkMemoryLimit(content.length);
        const { value } = await this.getValue();
        value.push(content);
        if (this.filePath) {
            await this.saveToFile(value);
        }
        return await this.ctx.database.set(Agent.MEMORY_TABLE, { id: this.id, label: this.label }, { value });
    }

    async replace(old_content: string, new_content: string) {
        // 从记忆内容中搜索
        const { value } = await this.getValue();
        const index = value.findIndex((item) => item === old_content);
        if (index === -1) throw new Error("Memory not found");
        if (isEmpty(new_content)) {
            value.splice(index, 1);
        } else {
            await this.checkMemoryLimit(new_content.length - (this.value[index]?.length || 0));
            value[index] = new_content;
        }
        if (this.filePath) {
            await this.saveToFile(value);
        }
        await this.ctx.database.upsert("yesimbot.agent.memory_block", [{
            id: this.id,
            label: this.label,
            value,
            limit: this.limit
        }]);
    }

    async render(): Promise<string> {
        const { value } = await this.getValue();
        const currentSize = await this.size();
        return [
            `<${this.label} characters="${currentSize}/${this.limit}">`,
            ...value,
            `</${this.label}>`
        ].join('\n');
    }
}
