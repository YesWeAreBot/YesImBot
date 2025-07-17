import { promises as fs } from "fs";
import { Context, Logger, Service } from "koishi";
import path from "path";

import { Services } from "@/services/types";
import { AppError, ErrorCodes } from "@/shared/errors";
import { BasicArchivalStore, IArchivalMemoryStore } from "./BasicArchivalStore";
import { ARCHIVAL_MEMORY_TABLE, MemoryConfig } from "./config";
import { MemoryBlock } from "./MemoryBlock";
import { ArchivalEntry, ArchivalMemoryData, ArchivalSearchResult } from "./types";

declare module "koishi" {
    interface Context {
        [Services.Memory]: MemoryService;
    }
    interface Tables {
        [ARCHIVAL_MEMORY_TABLE]: ArchivalMemoryData;
    }
}

/**
 * @description LLM 操作记忆后返回的结构化结果
 */
export type MemoryOperationResult<T = any> = {
    success: boolean;
    message: string;
    data?: T;
};

interface MemoryData {
    lastModified: string;
    memoryBlocks: {
        title: string;
        label: string;
        limit: number;
        description: string;
        content: string[];
    }[];
    archivalCount: number;
}

/**
 * MemoryService 负责管理机器人的核心记忆和归档记忆，
 * 并向大模型暴露一组定义良好的工具接口，用于查询和修改记忆。
 */
export class MemoryService extends Service {
    // 2. 注入依赖，包括我们优化后的 archivalMemory 服务
    static readonly inject = [Services.Model, Services.Logger];

    private coreMemoryBlocks: Map<string, MemoryBlock> = new Map();
    private lastModified: Date = new Date();
    public readonly archivalStore: IArchivalMemoryStore;

    private _logger: Logger;

    constructor(ctx: Context, public readonly config: MemoryConfig) {
        super(ctx, Services.Memory, true);
        this._logger = ctx[Services.Logger].getLogger("[记忆服务]");

        ctx.model.extend(
            ARCHIVAL_MEMORY_TABLE,
            {
                id: "string",
                content: "text",
                timestamp: "timestamp",
                metadata: "json",
                embedding: "array",
            },
            {
                primary: "id",
            }
        );

        this.archivalStore = new BasicArchivalStore(ctx);
    }

    get blocks(): Map<string, MemoryBlock> {
        return this.coreMemoryBlocks;
    }

    public getCoreMemoryBlock(label: string): MemoryBlock | undefined {
        return this.coreMemoryBlocks.get(label);
    }

    protected async start() {
        await this.discoverAndLoadCoreMemoryBlocks();
        try {
            this.registerCommands();
        } catch (error) {
            this._logger.error(`注册命令失败: ${error.message}`);
        }
        this._logger.info(`服务已启动，加载了 ${this.coreMemoryBlocks.size} 个核心记忆块。`);
    }

    protected async stop() {
        for (const block of this.coreMemoryBlocks.values()) {
            await block
                .disposeFileWatcher()
                .catch((e) => this._logger.warn(`Error disposing watcher for ${block.label}: ${e.message}`));
        }
        this.coreMemoryBlocks.clear();
        this._logger.info("服务已停止");
    }

    private registerCommands() {
        this.ctx.command("memory", "记忆管理指令集", { authority: 3 });

        this.ctx.command("memory.core", "管理核心记忆", { authority: 3 });

        this.ctx.command("memory.archival", "管理归档记忆", { authority: 3 });

        this.ctx.command("memory.core.list", "列出所有核心记忆块", { authority: 3 }).action(async ({ session }) => {
            const result = this.listCoreMemoryBlocks();
            if (!result.success) {
                return `❌ ${result.message}`;
            }
            return `找到 ${result.data.length} 个核心记忆块：\n${result.data
                .map((b) => `- ${b.label}: ${b.title}`)
                .join("\n")}`;
        });

        this.ctx
            .command("memory.core.append <label:string> <content:text>", "向核心记忆块追加内容", { authority: 3 })
            .action(async ({ session }, label, content) => {
                const result = await this.appendToCoreMemory(label, content);
                return result.success ? `✅ ${result.message}` : `❌ ${result.message}`;
            });

        this.ctx
            .command("memory.core.overwrite <label:string> <content:string>", "覆盖核心记忆块的内容", { authority: 3 })
            .option("label", "-l <label:string> 记忆块的标签")
            .option("content", "-c <content:string> 要覆盖的内容")
            .action(async ({ session }, label, content) => {
                const result = await this.overwriteCoreMemory(label, content);
                return result.success ? `✅ ${result.message}` : `❌ ${result.message}`;
            });

        this.ctx
            .command("memory.core.replace <label:string>", "替换核心记忆块中的特定内容", { authority: 3 })
            .option("oldContent", "-o <oldContent:string> 旧内容")
            .option("newContent", "-n <newContent:string> 新内容")
            .action(async ({ session }, label, oldContent, newContent) => {
                const result = await this.replaceInCoreMemory(label, oldContent, newContent);
                return result.success ? `✅ ${result.message}` : `❌ ${result.message}`;
            });

        this.ctx
            .command("memory.archival.store <content:string>", "将内容存储到归档记忆中", { authority: 3 })
            .option("metadata", "-m <metadata:string> 要存储的元数据")
            .action(async ({ session }, content, metadata) => {
                const result = await this.storeInArchivalMemory(content, metadata ? JSON.parse(metadata) : undefined);
                return result.success ? `✅ ${result.message}` : `❌ ${result.message}`;
            });

        this.ctx
            .command("memory.archival.update <id:string>", "更新归档记忆中的内容", { authority: 3 })
            .option("content", "-c <content:string> 要更新的内容")
            .option("metadata", "-m <metadata:string> 要更新的元数据")
            .action(async ({ session }, id, content, metadata) => {
                const result = await this.updateInArchivalMemory(id, {
                    content,
                    metadata: metadata ? JSON.parse(metadata) : undefined,
                });
                return result.success ? `✅ ${result.message}` : `❌ ${result.message}`;
            });

        this.ctx
            .command("memory.archival.remove <id:string>", "从归档记忆中删除内容", { authority: 3 })
            .action(async ({ session }, id) => {
                const result = await this.removeFromArchivalMemory(id);
                return result.success ? `✅ ${result.message}` : `❌ ${result.message}`;
            });

        this.ctx
            .command("memory.archival.search <query:string>", "在归档记忆中进行语义搜索", { authority: 3 })
            .option("topK", "-k <topK:number> 返回结果的数量")
            .option("filterMetadata", "-f <filterMetadata:string> 过滤元数据")
            .action(async ({ session }, query, topK, filterMetadata) => {
                const result = await this.searchArchivalMemory(query, {
                    topK: topK ? Number(topK) : undefined,
                    filterMetadata: filterMetadata ? JSON.parse(filterMetadata) : undefined,
                });
                return `Found ${result.results.length} relevant memories (out of ${result.total} total).`;
            });

        this.ctx
            .command("memory.archival.count", "统计归档记忆中的记忆数量", { authority: 3 })
            .action(async ({ session }) => {
                const count = await this.archivalStore.count();
                return `Found ${count} memories in archival memory.`;
            });

        this.ctx.command("memory.archival.clear", "清空归档记忆", { authority: 3 }).action(async ({ session }) => {
            await this.archivalStore.clearAll();
            return `Archival memory cleared.`;
        });

        this.ctx
            .command("memory.archival.rebuild", "为所有归档记忆重新生成 embedding", { authority: 3 })
            .action(async ({ session }) => {
                const result = await this.archivalStore.rebuildEmbeddings();

                return `记忆重建完成
成功: ${result.successCount}
失败: ${result.failCount}`;
            });
    }

    /**
     * 扫描核心记忆目录，加载所有可用的记忆块。
     * @returns
     */
    private async discoverAndLoadCoreMemoryBlocks() {
        const memoryPath = this.config.coreMemoryPath;
        try {
            await fs.mkdir(memoryPath, { recursive: true });
            const files = await fs.readdir(memoryPath);
            const memoryFiles = files.filter((file) => file.endsWith(".md") || file.endsWith(".txt"));

            if (memoryFiles.length === 0) {
                this._logger.warn(`核心记忆目录 '${memoryPath}' 为空，未加载任何记忆块。`);
                return;
            }

            for (const file of memoryFiles) {
                const filePath = path.join(memoryPath, file);
                try {
                    const block = await MemoryBlock.createFromFile(this.ctx, filePath);
                    if (this.coreMemoryBlocks.has(block.label)) {
                        this._logger.warn(`发现重复的记忆块标签 '${block.label}'，来自文件 '${filePath}'。已忽略。`);
                    } else {
                        this.coreMemoryBlocks.set(block.label, block);
                        this._logger.debug(`已从文件 '${file}' 加载核心记忆块 '${block.label}'。`);
                    }
                } catch (error) {
                    //this._logger.error(`加载记忆块文件 '${filePath}' 失败: ${error.message}`);
                }
            }
        } catch (error) {
            this._logger.error(`扫描核心记忆目录 '${memoryPath}' 失败: ${error.message}`);
            throw new AppError("Failed to discover core memory blocks", {
                code: ErrorCodes.SERVICE.INITIALIZATION_FAILURE,
                cause: error,
            });
        }
    }
    private getCoreMemoryBlockOrThrow(label: string): MemoryBlock {
        const block = this.coreMemoryBlocks.get(label);
        if (!block) {
            const available = Array.from(this.coreMemoryBlocks.keys()).join(", ") || "None";
            this._logger.error(`核心记忆块 "${label}" 不存在。可用的有: [${available}]`);
            throw new AppError(`核心记忆块 "${label}" 不存在`, {
                code: ErrorCodes.RESOURCE.NOT_FOUND,
                context: { resourceType: "MemoryBlock", resourceId: label, available },
            });
        }
        return block;
    }

    /**
     * 列出所有可用的核心记忆块及其描述。
     * LLM 应首先使用此工具来了解可以操作哪些记忆块。
     * @returns 一个包含所有核心记忆块信息的对象数组。
     */
    public listCoreMemoryBlocks(): MemoryOperationResult {
        const blocks = Array.from(this.coreMemoryBlocks.values()).map((block) => ({
            label: block.label,
            title: block.title,
            description: block.description,
        }));

        return {
            success: true,
            message: `Found ${blocks.length} core memory blocks.`,
            data: blocks,
        };
    }

    /**
     * 向指定的核心记忆块末尾追加新内容。
     * @param label 记忆块的唯一标签 (例如: "persona", "user_profile")。
     * @param content 要追加的单行或多行文本内容。
     * @returns 操作结果对象。
     */
    public async appendToCoreMemory(label: string, content: string): Promise<MemoryOperationResult> {
        try {
            const block = this.getCoreMemoryBlockOrThrow(label);
            if (this.config.backup?.enabled) {
                await block.backup(this.config.backup.backupPath);
            }
            await block.append(content);
            this.lastModified = new Date();
            return { success: true, message: `Successfully appended to core memory block <${label}>.` };
        } catch (error) {
            this._logger.error(`Failed to append to core memory <${label}>: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    /**
     * 完全覆盖指定核心记忆块的所有内容。
     * @param label 记忆块的唯一标签。
     * @param newContent 将要写入的全新内容，多行文本请使用 \n 分隔。
     * @returns 操作结果对象。
     */
    public async overwriteCoreMemory(label: string, newContent: string): Promise<MemoryOperationResult> {
        try {
            const block = this.getCoreMemoryBlockOrThrow(label);
            const newContentLines = newContent.split(/\r?\n/);
            if (this.config.backup?.enabled) {
                await block.backup(this.config.backup.backupPath);
            }
            await block.overwrite(newContentLines);
            this.lastModified = new Date();
            return { success: true, message: `Successfully overwrote core memory block <${label}>.` };
        } catch (error) {
            this._logger.error(`Failed to overwrite core memory <${label}>: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    /**
     * 替换核心记忆块中的特定内容。
     * @warning 此函数会替换找到的第一个完全匹配的 `oldContent`。如果内容有多处重复或只是部分匹配，可能会导致意外结果。
     * 对于更可靠的更新，建议读取整个块，在本地修改后，使用 `overwriteCoreMemory` 进行覆盖。
     * @param label 记忆块的唯一标签。
     * @param oldContent 要被替换的旧的、完整的文本行。
     * @param newContent 用来替换的新文本行。
     * @returns 操作结果对象。
     */
    public async replaceInCoreMemory(
        label: string,
        oldContent: string,
        newContent: string
    ): Promise<MemoryOperationResult<ArchivalEntry>> {
        try {
            const block = this.getCoreMemoryBlockOrThrow(label);
            if (this.config.backup?.enabled) {
                await block.backup(this.config.backup.backupPath);
            }
            await block.replace(oldContent, newContent);
            this.lastModified = new Date();
            return { success: true, message: `Successfully replaced content in core memory block <${label}>.` };
        } catch (error) {
            this._logger.error(`Failed to replace in core memory <${label}>: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    /**
     * 将一段信息存储到归档记忆中，使其可以通过语义搜索被检索。
     * 归档记忆用于长期存储事实、事件和对话片段。
     * @param content 要存储的文本内容。
     * @param metadata (可选) 一个用于过滤的 JSON 对象，例如 `{ "source": "conversation_id_123" }`。
     * @returns 操作结果对象，其中 data 包含新创建的记忆 ID。
     */
    public async storeInArchivalMemory(
        content: string,
        metadata?: Record<string, any>
    ): Promise<MemoryOperationResult<ArchivalEntry>> {
        if (!this.archivalStore) {
            return { success: false, message: "Archival memory service is not available." };
        }
        try {
            const entry = await this.archivalStore.store(content, metadata);
            this.lastModified = new Date();
            return {
                success: true,
                message: `Successfully stored content in archival memory with ID ${entry.id}.`,
                data: entry,
            };
        } catch (error) {
            this._logger.error(`Failed to store in archival memory: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    public async updateInArchivalMemory(
        id: string,
        data: { content?: string; metadata?: Record<string, any> }
    ): Promise<MemoryOperationResult> {
        try {
            const updatedEntry = await this.archivalStore.update(id, data);
            if (!updatedEntry) {
                return { success: false, message: `Archival memory with ID '${id}' not found.` };
            }
            this.lastModified = new Date();
            return {
                success: true,
                message: `Successfully updated archival memory with ID ${updatedEntry.id}.`,
                data: updatedEntry,
            };
        } catch (error) {
            this._logger.error(`Failed to update archival memory ${id}: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    public async removeFromArchivalMemory(id: string): Promise<MemoryOperationResult> {
        try {
            const success = await this.archivalStore.remove(id);
            if (!success) {
                return { success: false, message: `Archival memory with ID '${id}' not found.` };
            }
            this.lastModified = new Date();
            return {
                success: true,
                message: `Successfully removed archival memory with ID ${id}.`,
            };
        } catch (error) {
            this._logger.error(`Failed to remove archival memory ${id}: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    /**
     * 在归档记忆中进行语义搜索。
     * 用于根据意义和上下文查找相关的历史信息，而不仅仅是关键词匹配。
     * @param query 描述你想要寻找什么信息的自然语言查询。
     * @param options (可选) 包含 `topK` (返回数量) 和 `filterMetadata` (元数据过滤器) 的对象。
     * @returns 一个格式化好的字符串，总结了最相关的搜索结果，可以直接在后续思考中使用。如果找不到则返回空。
     */
    public async searchArchivalMemory(
        query: string,
        options?: { topK?: number; filterMetadata?: Record<string, any>; similarityThreshold?: number }
    ): Promise<ArchivalSearchResult> {
        try {
            return await this.archivalStore.search(query, options);
        } catch (error) {
            this._logger.error(`Failed to search archival memory: ${error.message}`);
            // * 向上抛出异常，让调用者 (MemoryExtension) 处理
            throw error;
        }
    }

    public async getMemoryDataForRendering(): Promise<MemoryData> {
        return {
            lastModified: this.lastModified.toISOString(),
            memoryBlocks: Array.from(this.coreMemoryBlocks.values()).map((block) => ({
                title: block.title,
                label: block.label,
                limit: block.limit,
                description: block.description,
                content: block.content as string[],
            })),
            archivalCount: await this.archivalStore.count(),
        };
    }
}
