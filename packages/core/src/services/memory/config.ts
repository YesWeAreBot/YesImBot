import { Schema } from "koishi";

/**
 * 归档记忆的数据库表名
 */
export const ARCHIVAL_MEMORY_TABLE = "yesimbot.archival_memory";

/** 记忆服务配置 */
export interface MemoryConfig {
    /** 核心记忆块文件的存放目录 */
    coreMemoryPath: string;

    /** 归档记忆备份配置 (可选) */
    backup?: {
        enabled: boolean;
        backupPath: string;
    };
}

export const MemoryConfigSchema: Schema<MemoryConfig> = Schema.object({
    coreMemoryPath: Schema.path({ filters: ["directory"], allowCreate: true })
        .default("data/yesimbot/memory/core")
        .description("核心记忆块文件的存放目录，服务启动时会自动扫描此目录下的 .md 文件。"),
    backup: Schema.object({
        enabled: Schema.boolean().default(false).description("是否启用备份"),
        backupPath: Schema.path({ filters: ["directory"], allowCreate: true })
            .default("data/yesimbot/memory/backup")
            .description("备份路径"),
    }),
});
