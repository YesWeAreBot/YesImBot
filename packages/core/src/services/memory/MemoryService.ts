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

export class MemoryService extends Service {
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

        this._logger.info("服务已初始化");
    }

    protected async start() {
        this._logger.info("服务启动中...");
        await this.discoverAndLoadCoreMemoryBlocks();
        this._logger.info(`服务已启动，加载了 ${this.coreMemoryBlocks.size} 个核心记忆块。`);
    }

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
                    this._logger.error(`加载记忆块文件 '${filePath}' 失败: ${error.message}`);
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

    public getCoreMemoryBlock(label: string): MemoryBlock | undefined {
        return this.coreMemoryBlocks.get(label);
    }

    public getAllCoreMemoryBlocks(): MemoryBlock[] {
        return Array.from(this.coreMemoryBlocks.values());
    }

    public async getMemoryDataForRendering(): Promise<{
        lastModified: string;
        memoryBlocks: {
            title: string;
            label: string;
            limit: number;
            description: string;
            content: string[];
        }[];
        archivalCount: number;
    }> {
        return {
            lastModified: this.lastModified.toISOString(),
            memoryBlocks: this.getAllCoreMemoryBlocks().map((block) => ({
                title: block.title,
                label: block.label,
                limit: block.limit,
                description: block.description,
                content: block.content as string[],
            })),
            archivalCount: await this.archivalStore.count(),
        };
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

    public async appendToCoreMemory(label: string, content: string): Promise<string> {
        const block = this.getCoreMemoryBlockOrThrow(label);
        await block.append(content);
        this.lastModified = new Date();
        return `Successfully appended to core memory block <${label}>.`;
    }

    public async replaceInCoreMemory(label: string, oldContent: string, newContent: string): Promise<string> {
        const block = this.getCoreMemoryBlockOrThrow(label);
        await block.replace(oldContent, newContent);
        this.lastModified = new Date();
        return `Successfully replaced content in core memory block <${label}>.`;
    }

    public async overwriteCoreMemory(label: string, newContent: string): Promise<string> {
        const block = this.getCoreMemoryBlockOrThrow(label);
        // Split content into lines, handling both \n and \r\n
        const newContentLines = newContent.split(/\r?\n/);
        await block.overwrite(newContentLines);
        this.lastModified = new Date();
        return `Successfully overwrote core memory block <${label}>.`;
    }

    public async storeInArchivalMemory(content: string, metadata?: Record<string, any>): Promise<ArchivalEntry> {
        const entry = await this.archivalStore.store(content, metadata);
        this.lastModified = new Date();
        return entry;
    }

    public async searchArchivalMemory(
        query: string,
        options?: { topK?: number; filterMetadata?: Record<string, any> }
    ): Promise<ArchivalSearchResult> {
        return await this.archivalStore.search(query, options);
    }

    protected async stop() {
        for (const block of this.coreMemoryBlocks.values()) {
            await block.disposeFileWatcher().catch((e) => this._logger.warn(`Error disposing watcher for ${block.label}: ${e.message}`));
        }
        this.coreMemoryBlocks.clear();
        this._logger.info("服务已停止");
    }
}
