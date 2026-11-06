import fs from "fs/promises";
import { watch, type FSWatcher } from "node:fs";
import path from "path";

import { Context, Logger } from "koishi";

import { Config } from "../config";
import type { LoggerService } from "../logger";
import { RESOURCES_DIR } from "../shared/constants";
import { YesImBotService } from "../shared/service";
import { MemoryBlock, MemoryBlockData } from "./memory-block";

export class MemoryService extends YesImBotService<Config> {
    private logger: Logger;

    private disposed = false;
    private watcher?: FSWatcher;
    private reloadTimer?: ReturnType<typeof setTimeout>;
    private initialized = false;
    private loadGeneration = 0;
    private coreMemoryBlocks: Map<string, MemoryBlock> = new Map();

    constructor(
        ctx: Context,
        config: Config,
        private readonly logging: LoggerService,
    ) {
        super(ctx, config);
        this.logger = logging.getLogger("[核心记忆]");
    }

    public async start() {
        await this.loadCoreMemoryBlocks();
        if (this.disposed) return;
        this.watcher = watch(this.config.coreMemoryPath, () => {
            if (this.reloadTimer) clearTimeout(this.reloadTimer);
            this.reloadTimer = setTimeout(() => {
                this.reloadTimer = undefined;
                void this.loadCoreMemoryBlocks();
            }, 50);
        });
        // Close the read/watch gap, including files deleted during startup.
        await this.loadCoreMemoryBlocks();
    }

    public stop() {
        this.disposed = true;
        this.watcher?.close();
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.loadGeneration++;
        for (const block of this.coreMemoryBlocks.values()) block.dispose();
        this.coreMemoryBlocks.clear();
    }

    public getMemoryBlocksForRendering(): MemoryBlockData[] {
        return Array.from(this.coreMemoryBlocks.values()).map((block) => block.toData());
    }

    /**
     * 扫描核心记忆目录，加载所有可用的记忆块
     */
    public async loadCoreMemoryBlocks() {
        if (this.disposed) return;
        const generation = ++this.loadGeneration;
        const active = () => !this.disposed && generation === this.loadGeneration;
        const memoryPath = this.config.coreMemoryPath;
        try {
            await fs.mkdir(memoryPath, { recursive: true });
            if (!active()) return;
            let files = await fs.readdir(memoryPath);
            if (!active()) return;
            let memoryFiles = files.filter((file) => file.endsWith(".md") || file.endsWith(".txt"));

            if (!this.initialized && memoryFiles.length === 0) {
                this.logger.warn(`核心记忆目录 '${memoryPath}' 为空，将应用默认设定`);
                try {
                    const defaultMemoryFiles = await fs.readdir(path.join(RESOURCES_DIR, "memory_block"));
                    if (!active()) return;
                    for (const file of defaultMemoryFiles) {
                        await fs.copyFile(path.join(RESOURCES_DIR, "memory_block", file), path.join(memoryPath, file));
                        if (!active()) return;
                    }
                    files = await fs.readdir(memoryPath);
                    if (!active()) return;
                    memoryFiles = files.filter((file) => file.endsWith(".md") || file.endsWith(".txt"));
                } catch (error) {
                    if (active()) this.logger.error(`复制默认记忆块失败: ${error.message}`);
                    return;
                }
            }

            this.initialized = true;
            const next = new Map<string, MemoryBlock>();
            for (const file of memoryFiles.sort()) {
                if (!active()) {
                    for (const block of next.values()) block.dispose();
                    return;
                }
                const filePath = path.join(memoryPath, file);
                try {
                    const block = await MemoryBlock.createFromFile(this.ctx, this.logging, filePath, { watch: false, bindDisposal: false });
                    if (!active()) {
                        block.dispose();
                        for (const loaded of next.values()) loaded.dispose();
                        return;
                    }
                    if (next.has(block.label)) {
                        block.dispose();
                        this.logger.warn(`发现重复的记忆块标签 '${block.label}'，来自文件 '${filePath}'已忽略`);
                    } else {
                        next.set(block.label, block);
                        this.logger.debug(`已从文件 '${file}' 加载核心记忆块 '${block.label}'`);
                    }
                } catch {
                    // A failed block must not prevent loading the remaining files.
                }
            }
            if (!active()) {
                for (const block of next.values()) block.dispose();
                return;
            }
            const previous = this.coreMemoryBlocks;
            this.coreMemoryBlocks = next;
            for (const block of previous.values()) block.dispose();
        } catch (error) {
            if (active()) this.logger.error(`扫描核心记忆目录 '${memoryPath}' 失败: ${error.message}`);
        }
    }
}
