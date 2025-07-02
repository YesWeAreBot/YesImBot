import { Schema } from "koishi";
import { SystemConfig } from "../../config";

export const MEMORY_TABLE = "yesimbot.memory_block";

/** 记忆压缩触发条件 (判别联合类型，UI 绝佳实践) */
export type MemoryCompressionTrigger =
    | { mode: "disabled" } // 明确的禁用选项
    | { mode: "lineCount"; threshold: number }
    | { mode: "charCount"; threshold: number }
    | { mode: "messageInterval"; count: number };

export interface MemoryBlockConfig {
    limit: number;
    filePathToBind?: string;
}

/** 记忆服务配置 */
export interface MemoryConfig {
    /** 定义不同的记忆块。键为记忆块名称，如 "persona", "scratchpad"。 */
    blocks?: Record<string, MemoryBlockConfig>;

    /** 记忆备份配置 */
    backup?: {
        enabled: boolean;
        backupPath: string;
    };
    readonly system?: SystemConfig;
}

export const MemoryConfigSchema: Schema<MemoryConfig> = Schema.object({
    blocks: Schema.dict(
        Schema.object({
            limit: Schema.number().default(1000).description("记忆块大小限制"),
            filePathToBind: Schema.string().description("绑定的文件路径"),
        })
    )
        .default({
            human: { limit: 1000, filePathToBind: "data/yesimbot/memory/human.txt" },
            persona: { limit: 1000, filePathToBind: "data/yesimbot/memory/persona.txt" },
        })
        .role("table")
        .description('定义不同的记忆块。键为记忆块名称，如 "persona"。'),
    backup: Schema.object({
        enabled: Schema.boolean().default(false).description("是否启用备份"),
        backupPath: Schema.string().default("data/yesimbot/memory/backup").description("备份路径"),
    }),
});
