import fs from "fs/promises";
import path from "path";

import { Context, Service } from "koishi";

import { Config } from "../../config";
import { RESOURCES_DIR, Services } from "../../shared/constants";
import { MemoryBlock, MemoryBlockData } from "./memory-block";

declare module "koishi" {
    interface Context {
        [Services.Memory]: MemoryService;
    }
}

export class MemoryService extends Service<Config> {
    static readonly inject = [Services.Logger];

    private disposed = false;
    private loadGeneration = 0;
    private coreMemoryBlocks: Map<string, MemoryBlock> = new Map();

    constructor(ctx: Context, config: Config) {
        super(ctx, Services.Memory, true);
        this.config = config;
        this.logger = ctx[Services.Logger].getLogger("[核心记忆]");
        ctx.on("dispose", () => this.stop());
    }

    protected async start() {
        await this.loadCoreMemoryBlocks();
    }

    protected stop() {
        this.disposed = true;
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

            if (memoryFiles.length === 0) {
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

            for (const file of memoryFiles) {
                if (!active()) return;
                const filePath = path.join(memoryPath, file);
                try {
                    const block = await MemoryBlock.createFromFile(this.ctx, filePath);
                    if (!active()) {
                        block.dispose();
                        return;
                    }
                    if (this.coreMemoryBlocks.has(block.label)) {
                        block.dispose();
                        this.logger.warn(`发现重复的记忆块标签 '${block.label}'，来自文件 '${filePath}'已忽略`);
                    } else {
                        this.coreMemoryBlocks.set(block.label, block);
                        this.logger.debug(`已从文件 '${file}' 加载核心记忆块 '${block.label}'`);
                    }
                } catch {
                    // A failed block must not prevent loading the remaining files.
                }
            }
        } catch (error) {
            if (active()) this.logger.error(`扫描核心记忆目录 '${memoryPath}' 失败: ${error.message}`);
        }
    }
}
