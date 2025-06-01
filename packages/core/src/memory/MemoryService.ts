import { Context, Service } from "koishi";
import { MEMORY_TABLE } from "../types/model";
import { formatDate } from "../utils";
import { DatabaseMemoryBlockStore, IMemoryBlockStore } from "./DatabaseMemoryBlockStore";
import { ArchivalEntry, ArchivalSearchResult, IArchivalMemoryStore, InMemoryArchivalStore } from "./InMemoryArchivalStore";
import { MemoryBlock } from "./MemoryBlock";
import { MemoryError } from "./MemoryError";

export interface CoreMemoryBlockConfig {
    limit?: number;
    initialValue?: string[];
    filePathToBind?: string;
}
export interface MemoryServiceConfig {
    coreBlockDefaults?: {
        persona?: CoreMemoryBlockConfig;
        human?: CoreMemoryBlockConfig;
        [key: string]: CoreMemoryBlockConfig | undefined;
    };
    // Future: Allow selection of IMemoryBlockStore and IArchivalMemoryStore implementations via config
}

declare module "koishi" {
    interface Context {
        memory: MemoryService;
    }
}

export class MemoryService extends Service {
    private coreMemoryBlocks: Map<string, MemoryBlock> = new Map();
    private lastModified: Date = new Date();
    private readonly memoryBlockStore: IMemoryBlockStore;
    public readonly archivalStore: IArchivalMemoryStore;

    constructor(ctx: Context, config: MemoryServiceConfig = {}) {
        super(ctx, "memory", true);

        this.memoryBlockStore = new DatabaseMemoryBlockStore(ctx);
        this.archivalStore = new InMemoryArchivalStore(ctx);

        ctx.on("ready", async () => {
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

            ctx.logger.info("Starting MemoryService and initializing core blocks...");
            // Initialize 'persona' and 'human' core blocks as per requirements
            const personaConfig = config.coreBlockDefaults?.persona || {};
            await this.getOrCreateCoreMemoryBlock("persona", {
                limit: personaConfig.limit ?? 2000,
                initialValue: personaConfig.initialValue ?? ["Persona not yet defined."],
                filePathToBind: personaConfig.filePathToBind,
            });

            const humanConfig = config.coreBlockDefaults?.human || {};
            await this.getOrCreateCoreMemoryBlock("human", {
                limit: humanConfig.limit ?? 1000,
                initialValue: humanConfig.initialValue ?? ["User information not yet available."],
                filePathToBind: humanConfig.filePathToBind,
            });
            this.ctx.logger.info('Core blocks "persona" and "human" ensured.');

            for (let label of Object.keys(config.coreBlockDefaults)) {
                if (label === "persona" || label === "human") continue;

                const blockConfig = config.coreBlockDefaults[label];
                await this.getOrCreateCoreMemoryBlock(label, {
                    limit: blockConfig.limit ?? 1000,
                    initialValue: blockConfig.initialValue ?? ["This selection not yet available."],
                    filePathToBind: blockConfig.filePathToBind,
                });
            }
        });

        ctx.logger.info("Initialized.");
    }

    public async getOrCreateCoreMemoryBlock(label: string, customConfig: CoreMemoryBlockConfig = {}): Promise<MemoryBlock> {
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
                initialValue: customConfig.initialValue,
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

    public async appendToCoreMemory(label: string, content: string): Promise<string> {
        if (label !== "persona" && label !== "human") {
            throw new MemoryError(`Core memory operations are restricted to 'persona' and 'human' blocks. Attempted on: '${label}'.`);
        }
        const block = this.getCoreMemoryBlockOrThrow(label);
        await block.append(content);
        this.lastModified = new Date();
        this.ctx.logger.info(`Appended to core memory "${label}".`);
        return `Successfully appended to core memory block <${label}>.`;
    }

    public async replaceInCoreMemory(label: string, oldContent: string, newContent: string): Promise<string> {
        if (label !== "persona" && label !== "human") {
            throw new MemoryError(`Core memory operations are restricted to 'persona' and 'human' blocks. Attempted on: '${label}'.`);
        }
        const block = this.getCoreMemoryBlockOrThrow(label);
        await block.replace(oldContent, newContent);
        this.lastModified = new Date();
        this.ctx.logger.info(`Replaced in core memory "${label}".`);
        return `Successfully replaced content in core memory block <${label}>.`;
    }

    public async getCoreMemoryContentForPrompt(): Promise<string> {
        // const personaBlock = this.getCoreMemoryBlock("persona");
        // const humanBlock = this.getCoreMemoryBlock("human");

        const extraBlocks = [...this.coreMemoryBlocks.values()];

        const blockContent = extraBlocks.map((mb) => {
            return [
                `<${mb.label} limit="${mb.currentSize}/${mb.limit} lastModified="${formatDate(mb.lastModified)}">`,
                ...mb.content,
                `</${mb.label}>`,
            ].join("\n");
        });

        return [
            `### Memory [last modified: ${formatDate(this.lastModified)}]`,
            `${await this.archivalStore.count()} total memories you created are stored in archival memory (use functions to access them)`,
            ``,
            `Core memory shown below (limited in size, additional information stored in archival / recall memory):`,
            ...blockContent,
        ].join("\n");
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
