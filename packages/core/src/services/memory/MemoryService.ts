import { Context, Logger, Service } from "koishi";
import { AppError, ErrorCodes } from "../../shared";
import { Services } from "../types";
import { MEMORY_TABLE, MemoryBlockConfig, MemoryConfig } from "./config";
import { DatabaseMemoryBlockStore, IMemoryBlockStore } from "./DatabaseMemoryBlockStore";
import { IArchivalMemoryStore, InMemoryArchivalStore } from "./InMemoryArchivalStore";
import { MemoryBlock } from "./MemoryBlock";
import { ArchivalEntry, ArchivalSearchResult, MemoryBlockData } from "./types";

declare module "koishi" {
    interface Context {
        [Services.Memory]: MemoryService;
    }
    interface Tables {
        [MEMORY_TABLE]: MemoryBlockData;
    }
}

export class MemoryService extends Service {
    static readonly inject = [Services.Model, Services.Logger];

    private coreMemoryBlocks: Map<string, MemoryBlock> = new Map();
    private lastModified: Date = new Date();
    private readonly memoryBlockStore: IMemoryBlockStore;
    public readonly archivalStore: IArchivalMemoryStore;

    private _logger: Logger;

    constructor(ctx: Context, public readonly config: MemoryConfig) {
        super(ctx, Services.Memory, true);

        ctx.model.extend(
            MEMORY_TABLE,
            {
                id: "string",
                label: "string",
                content: "array",
                limit: "integer",
            },
            {
                primary: ["id", "label"],
                autoInc: false,
            }
        );

        this.memoryBlockStore = new DatabaseMemoryBlockStore(ctx);
        this.archivalStore = new InMemoryArchivalStore(ctx);

        this._logger = ctx[Services.Logger].getLogger("[记忆服务]");

        this._logger.info("服务已启动");
    }

    protected async start() {
        if (this.config.blocks) {
            for (const label in this.config.blocks) {
                if (Object.prototype.hasOwnProperty.call(this.config.blocks, label)) {
                    const blockConfig = this.config.blocks[label];
                    await this.getOrCreateCoreMemoryBlock(label, blockConfig);
                }
            }
        } else {
            this._logger.warn("未配置任何核心记忆块");
        }
    }

    public async getOrCreateCoreMemoryBlock(label: string, customConfig: MemoryBlockConfig): Promise<MemoryBlock> {
        if (this.coreMemoryBlocks.has(label)) {
            const existingBlock = this.coreMemoryBlocks.get(label)!;

            if (customConfig.limit !== undefined && existingBlock.limit !== customConfig.limit) {
                this._logger.warn(`核心记忆块 "${label}" 已存在，但配置中的大小限制与现有值不同。使用现有值。`);
            }
            return existingBlock;
        }

        const block = await MemoryBlock.getOrCreate(
            this.ctx,
            { label },
            {
                defaultLimit: customConfig.limit ?? 5000,
                initialValue: [],
                store: this.memoryBlockStore,
                filePathToBind: customConfig.filePathToBind,
            }
        );
        this.coreMemoryBlocks.set(label, block);
        this._logger.info(`核心记忆块 "${label}" 已创建`);
        return block;
    }

    public getCoreMemoryBlock(label: string): MemoryBlock | undefined {
        return this.coreMemoryBlocks.get(label);
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

    public async getProvider(): Promise<{
        lastModified: string;
        archivalCount: number;
        memoryBlocks: MemoryBlockData[];
    }> {
        return {
            lastModified: this.lastModified.toISOString(),
            archivalCount: await this.archivalStore.count(),
            memoryBlocks: Array.from(this.coreMemoryBlocks.values()).map((block) => {
                return {
                    id: block.id,
                    label: block.label,
                    content: block.content as string[],
                    limit: block.limit,
                };
            }),
        };
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

    public async storeInArchivalMemory(content: string, metadata?: Record<string, any>): Promise<ArchivalEntry> {
        try {
            const entry = await this.archivalStore.store(content, metadata);
            this.lastModified = new Date();

            return entry;
        } catch (error) {
            throw new AppError(`Store in archival memory failed`, {
                code: ErrorCodes.RESOURCE.STORAGE_FAILURE,
                context: { content, metadata },
                cause: error,
            });
        }
    }

    public async searchArchivalMemory(
        query: string,
        options?: { page?: number; pageSize?: number; filterMetadata?: Record<string, any> }
    ): Promise<ArchivalSearchResult> {
        try {
            const searchResult = await this.archivalStore.search(query, options);

            return searchResult;
        } catch (error) {
            throw new AppError(`Search archival memory failed`, {
                code: ErrorCodes.RESOURCE.STORAGE_FAILURE,
                context: { query, options },
                cause: error,
            });
        }
    }

    protected async stop() {
        for (const block of this.coreMemoryBlocks.values()) {
            await block.disposeFileWatcher().catch((e) => this._logger.warn(`Error disposing watcher for ${block.label}: ${e.message}`));
        }
        this.coreMemoryBlocks.clear();

        if (this.archivalStore.clearAll) {
            await this.archivalStore.clearAll().catch((e) => this.ctx.logger.warn(`Error clearing archival store: ${e.message}`));
        }
        this._logger.info("服务已停止");
    }
}
