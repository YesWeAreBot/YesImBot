import { Context, Service } from "koishi";
import { ChatModel, ModelGroup } from "../model";
import { Services } from "../types";
import { DatabaseMemoryBlockStore, IMemoryBlockStore } from "./DatabaseMemoryBlockStore";

import { IArchivalMemoryStore, InMemoryArchivalStore } from "./InMemoryArchivalStore";
import { MemoryBlock } from "./MemoryBlock";
import { MemoryError } from "./MemoryError";
import { ArchivalEntry, ArchivalSearchResult, MemoryBlockCompressionState, MemoryBlockData } from "./types";
import { MEMORY_TABLE, MemoryBlockConfig, MemoryConfig } from "./config";

declare module "koishi" {
    interface Context {
        [Services.Memory]: MemoryService;
    }
    interface Tables {
        [MEMORY_TABLE]: MemoryBlockData;
    }
}

export class MemoryService extends Service {
    static readonly inject = [Services.Model];

    private coreMemoryBlocks: Map<string, MemoryBlock> = new Map();
    private lastModified: Date = new Date();
    private readonly memoryBlockStore: IMemoryBlockStore;
    public readonly archivalStore: IArchivalMemoryStore;

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

        ctx.logger.info("MemoryService initialized.");
    }

    protected async start() {
        this.ctx.logger.info("Starting MemoryService and initializing core blocks...");
        if (this.config.blocks) {
            for (const label in this.config.blocks) {
                if (Object.prototype.hasOwnProperty.call(this.config.blocks, label)) {
                    const blockConfig = this.config.blocks[label];
                    await this.getOrCreateCoreMemoryBlock(label, blockConfig);
                    this.ctx.logger.info(`Core memory block "${label}" ensured.`);
                }
            }
        } else {
            this.ctx.logger.info(
                `No Block configured. Standard blocks like "persona" or "human" should be explicitly created if needed or defined in config.`
            );
        }
    }

    public async getOrCreateCoreMemoryBlock(label: string, customConfig: MemoryBlockConfig): Promise<MemoryBlock> {
        if (this.coreMemoryBlocks.has(label)) {
            const existingBlock = this.coreMemoryBlocks.get(label)!;
            // Optionally update config like limit if provided for an existing block
            if (customConfig.limit !== undefined && existingBlock.limit !== customConfig.limit) {
                // This would require MemoryBlock to have a setLimit method and persist it
                this.ctx.logger.warn(`Limit change for existing block ${label} not yet implemented.`);
            }
            return existingBlock;
        }

        const block = await MemoryBlock.getOrCreate(
            this.ctx,
            { label },
            {
                defaultLimit: customConfig.limit ?? 5000, // A general default if not specified
                initialValue: [],
                store: this.memoryBlockStore,
                filePathToBind: customConfig.filePathToBind,
            }
        );
        this.coreMemoryBlocks.set(label, block);
        this.ctx.logger.debug(`Core memory block "${label}" loaded/created.`);
        return block;
    }

    public getCoreMemoryBlock(label: string): MemoryBlock | undefined {
        return this.coreMemoryBlocks.get(label);
    }

    private getCoreMemoryBlockOrThrow(label: string): MemoryBlock {
        const block = this.coreMemoryBlocks.get(label);
        if (!block) {
            const available = Array.from(this.coreMemoryBlocks.keys()).join(", ") || "None";
            this.ctx.logger.error(`Core memory block "${label}" not found. Available: [${available}]`);
            throw new MemoryError("Core memory block not found", { label, availableLabels: Array.from(this.coreMemoryBlocks.keys()) });
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
        this.ctx.logger.info(`Appended to core memory "${label}".`);

        return `Successfully appended to core memory block <${label}>.`;
    }

    public async replaceInCoreMemory(label: string, oldContent: string, newContent: string): Promise<string> {
        const block = this.getCoreMemoryBlockOrThrow(label);
        await block.replace(oldContent, newContent);
        this.lastModified = new Date();
        this.ctx.logger.info(`Replaced in core memory "${label}".`);
        return `Successfully replaced content in core memory block <${label}>.`;
    }

    public async storeInArchivalMemory(content: string, metadata?: Record<string, any>): Promise<ArchivalEntry> {
        try {
            const entry = await this.archivalStore.store(content, metadata);
            this.lastModified = new Date();
            this.ctx.logger.info(`Stored in archival memory. ID: ${entry.id}`);
            return entry;
        } catch (error) {
            this.ctx.logger.error(`Failed to store in archival memory: ${error.message}`);
            throw new MemoryError(`Store in archival memory failed`, { content, metadata, error });
        }
    }

    public async searchArchivalMemory(
        query: string,
        options?: { page?: number; pageSize?: number; filterMetadata?: Record<string, any> }
    ): Promise<ArchivalSearchResult> {
        try {
            const searchResult = await this.archivalStore.search(query, options);
            this.ctx.logger.info(
                `Archival search for "${query}" returned ${searchResult.results.length} of ${searchResult.total} results.`
            );
            return searchResult; // Return raw results; formatting can be done by the tool/caller
        } catch (error) {
            this.ctx.logger.error(`Failed to search archival memory: ${error.message}`);
            throw new MemoryError(`Search archival memory failed`, { query, options, error });
        }
    }

    protected async stop() {
        this.ctx.logger.info("Stopping MemoryService...");

        for (const block of this.coreMemoryBlocks.values()) {
            await block.disposeFileWatcher().catch((e) => this.ctx.logger.warn(`Error disposing watcher for ${block.label}: ${e.message}`));
        }
        this.coreMemoryBlocks.clear();

        if (this.archivalStore.clearAll) {
            await this.archivalStore.clearAll().catch((e) => this.ctx.logger.warn(`Error clearing archival store: ${e.message}`));
        }
        this.ctx.logger.info("MemoryService stopped and resources cleaned up.");
    }
}
