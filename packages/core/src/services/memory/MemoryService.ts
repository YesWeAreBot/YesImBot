import { Context, Service } from "koishi";
import { MEMORY_TABLE } from "../../shared";
import { ModelDescriptor } from "../model";
import { ChatModel } from "../model/impl/ChatModel";
import { DatabaseMemoryBlockStore, IMemoryBlockStore } from "./DatabaseMemoryBlockStore";
import { ArchivalEntry, ArchivalSearchResult, IArchivalMemoryStore, InMemoryArchivalStore } from "./InMemoryArchivalStore";
import { MemoryBlock } from "./MemoryBlock";
import { MemoryError } from "./MemoryError";

export interface CoreMemoryBlockConfig {
    limit?: number;
    initialValue?: string[];
    filePathToBind?: string;
}

export interface MemoryCompressionConfig {
    CompressionWhen?: "Lines" | "Characters" | "IntervalMessages" | "IntervalMinutes";
    Lines?: number;
    Characters?: number;
    IntervalMessages?: number;
    IntervalMinutes?: number;
    CustomPrompt?: string;
    CompressibleBlocks?: string[];
}

export interface BackupConfig {
    Enabled: boolean;
    BackupPath: string;
}

export interface MemoryServiceConfig {
    CoreBlockDefaults?: {
        persona?: CoreMemoryBlockConfig;
        human?: CoreMemoryBlockConfig;
        [key: string]: CoreMemoryBlockConfig | undefined;
    };
    Compression?: MemoryCompressionConfig;
    // Extract?: Config["Memory"]["Extract"];
    Backup?: BackupConfig;
    UseModel?: ModelDescriptor;
}

interface MemoryBlockCompressionState {
    messageCount: number; // 用于 IntervalMessages 计数
    lastCompressionTime: Date; // 用于 IntervalMinutes 计数
}

declare module "koishi" {
    interface Context {
        "yesimbot.memory": MemoryService;
    }
}

export class MemoryService extends Service {
    static readonly inject = ["yesimbot.model"];

    private coreMemoryBlocks: Map<string, MemoryBlock> = new Map();
    private lastModified: Date = new Date();
    private readonly memoryBlockStore: IMemoryBlockStore;
    public readonly archivalStore: IArchivalMemoryStore;

    private _compressionStates: Map<string, MemoryBlockCompressionState> = new Map();
    private _intervalCompressionTimer: NodeJS.Timeout | null = null;

    private chatModel: ChatModel;

    constructor(ctx: Context, public readonly config: MemoryServiceConfig = {}) {
        super(ctx, "yesimbot.memory", true);

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
        this.chatModel = ctx["yesimbot.model"].getChatModel(config.UseModel);
        ctx.logger.info("MemoryService initialized.");
    }

    protected async start() {
        this.ctx.logger.info("Starting MemoryService and initializing core blocks...");
        if (this.config.CoreBlockDefaults) {
            for (const label in this.config.CoreBlockDefaults) {
                if (Object.prototype.hasOwnProperty.call(this.config.CoreBlockDefaults, label)) {
                    const blockConfig = this.config.CoreBlockDefaults[label] || {};
                    await this.getOrCreateCoreMemoryBlock(label, {
                        limit: blockConfig.limit,
                        initialValue: blockConfig.initialValue,
                        filePathToBind: blockConfig.filePathToBind,
                    });
                    this.ctx.logger.info(`Core memory block "${label}" ensured.`);

                    // 为所有核心块初始化压缩状态
                    this._compressionStates.set(label, {
                        messageCount: 0,
                        lastCompressionTime: new Date(),
                    });
                    this.ctx.logger.debug(`Initialized compression state for block "${label}".`);
                }
            }

            // 设置定时任务，如果配置了按时间间隔压缩
            const intervalMinutes = this.config.Compression?.IntervalMinutes ?? 0;
            if (intervalMinutes > 0) {
                this._intervalCompressionTimer = setInterval(async () => {
                    this.ctx.logger.debug(`[Compression] Running scheduled check for all compressible blocks.`);
                    await this._triggerTimedCompression();
                }, intervalMinutes * 60 * 1000);
                this.ctx.logger.info(`[Compression] Scheduled compression check every ${intervalMinutes} minutes.`);
            }
        } else {
            this.ctx.logger.info(
                `No coreBlockDefaults configured. Standard blocks like "persona" or "human" should be explicitly created if needed or defined in config.`
            );
        }
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

    public async getProvider(): Promise<{
        lastModified: string;
        archivalCount: number;
        memoryBlocks: MemoryBlock[];
    }> {
        return {
            lastModified: this.lastModified.toISOString(),
            archivalCount: await this.archivalStore.count(),
            memoryBlocks: Array.from(this.coreMemoryBlocks.values()),
        };
    }

    public async appendToCoreMemory(label: string, content: string): Promise<string> {
        const compressibleBlocks = this.config.Compression?.CompressibleBlocks || [];

        const block = this.getCoreMemoryBlockOrThrow(label);
        await block.append(content);
        this.lastModified = new Date();
        this.ctx.logger.info(`Appended to core memory "${label}".`);

        // 更新消息计数并检查是否需要触发压缩
        const state = this._compressionStates.get(label);
        if (state && compressibleBlocks.includes(label)) {
            // 仅对可压缩块更新状态
            state.messageCount++;
            await this._checkAndTriggerCompression(label);
        }
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

    /**
     * 提供一个方法供外部调用
     * @param label
     */
    public async compression(label: string): Promise<void> {
        const block = this.getCoreMemoryBlock(label);
        const state = this._compressionStates.get(label);

        await this._performCompression(label, block, state);
    }

    // 新增：检查并触发压缩（非定时）
    private async _checkAndTriggerCompression(label: string): Promise<void> {
        const compressionConfig = this.config.Compression;
        const block = this.getCoreMemoryBlock(label);
        const state = this._compressionStates.get(label);

        // 如果未配置压缩、块或状态不存在，或该块不在可压缩列表中，则跳过
        if (!compressionConfig?.CompressibleBlocks?.includes(label) || !block || !state) {
            return;
        }

        const triggerWhen = compressionConfig.CompressionWhen;
        let shouldCompress = false;

        this.ctx.logger.debug(
            `[Compression] Checking ${label} for compression. Current: Lines=${block.content.length}, Chars=${block.currentSize}, Msgs=${state.messageCount}`
        );

        switch (triggerWhen) {
            case "Lines":
                if (compressionConfig.Lines > 0 && block.content.length >= compressionConfig.Lines) {
                    shouldCompress = true;
                    this.ctx.logger.info(
                        `[Compression] ${label} triggered by Lines threshold (${block.content.length}/${compressionConfig.Lines}).`
                    );
                }
                break;
            case "Characters":
                if (compressionConfig.Characters > 0 && block.currentSize >= compressionConfig.Characters) {
                    shouldCompress = true;
                    this.ctx.logger.info(
                        `[Compression] ${label} triggered by Characters threshold (${block.currentSize}/${compressionConfig.Characters}).`
                    );
                }
                break;
            case "IntervalMessages":
                if (compressionConfig.IntervalMessages > 0 && state.messageCount >= compressionConfig.IntervalMessages) {
                    shouldCompress = true;
                    this.ctx.logger.info(
                        `[Compression] ${label} triggered by IntervalMessages threshold (${state.messageCount}/${compressionConfig.IntervalMessages}).`
                    );
                }
                break;
            default:
                break; // IntervalMinutes 由 _triggerTimedCompression 处理
        }

        if (shouldCompress) {
            await this._performCompression(label, block, state);
        }
    }

    // 新增：触发定时压缩
    private async _triggerTimedCompression(): Promise<void> {
        const compressionConfig = this.config.Compression;
        if (!compressionConfig || !compressionConfig.IntervalMinutes || compressionConfig.IntervalMinutes <= 0) {
            return;
        }

        for (const label of compressionConfig.CompressibleBlocks || []) {
            const block = this.getCoreMemoryBlock(label);
            const state = this._compressionStates.get(label);

            if (!block || !state) continue;

            const timeDiffMinutes = (new Date().getTime() - state.lastCompressionTime.getTime()) / (1000 * 60);

            // 仅当 CompressionWhen 为 IntervalMinutes 时，才响应定时触发
            if (compressionConfig.CompressionWhen === "IntervalMinutes" && timeDiffMinutes >= compressionConfig.IntervalMinutes) {
                this.ctx.logger.info(
                    `[Compression] ${label} triggered by IntervalMinutes threshold (${timeDiffMinutes.toFixed(1)}/${
                        compressionConfig.IntervalMinutes
                    } mins).`
                );
                await this._performCompression(label, block, state);
            }
        }
    }

    // 新增：执行实际的压缩操作
    private async _performCompression(label: string, block: MemoryBlock, state: MemoryBlockCompressionState): Promise<void> {
        const compressionConfig = this.config.Compression;
        const backupConfig = this.config.Backup;
        const modelConfig = this.config.UseModel; // 使用 MemoryServiceConfig 中的 UseModel

        if (!compressionConfig || !modelConfig || !backupConfig) {
            this.ctx.logger.error(`[Compression] Missing configuration for compression for block ${label}. Skipping compression.`);
            return;
        }

        try {
            // 调用 MemoryBlock 的 compress 方法
            await block.compress(this.ctx, this.chatModel, compressionConfig, backupConfig);
            // 压缩成功后，重置状态
            state.messageCount = 0;
            state.lastCompressionTime = new Date();
            this.ctx.logger.info(`[Compression] Successfully compressed and reset state for block ${label}.`);
        } catch (error) {
            this.ctx.logger.error(`[Compression] Failed to compress block ${label}: ${error.message}`);
            // 压缩失败不阻止后续操作，但会记录错误。状态不重置，以便下次检查时可能再次触发。
        }
    }

    protected async stop() {
        this.ctx.logger.info("Stopping MemoryService...");
        if (this._intervalCompressionTimer) {
            clearInterval(this._intervalCompressionTimer);
            this._intervalCompressionTimer = null;
            this.ctx.logger.info("[Compression] Stopped interval compression timer.");
        }
        for (const block of this.coreMemoryBlocks.values()) {
            await block.disposeFileWatcher().catch((e) => this.ctx.logger.warn(`Error disposing watcher for ${block.label}: ${e.message}`));
        }
        this.coreMemoryBlocks.clear();
        this._compressionStates.clear(); // 清除所有压缩状态
        if (this.archivalStore.clearAll) {
            await this.archivalStore.clearAll().catch((e) => this.ctx.logger.warn(`Error clearing archival store: ${e.message}`));
        }
        this.ctx.logger.info("MemoryService stopped and resources cleaned up.");
    }
}
