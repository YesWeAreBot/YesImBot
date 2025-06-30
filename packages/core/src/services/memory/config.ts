import { ModelDescriptor } from "../model";

export const MEMORY_TABLE = "yesimbot.memory_block";

export interface MemoryBlockConfig {
    Limit?: number;
    FilePathToBind?: string;
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
    Block?: {
        persona?: MemoryBlockConfig;
        human?: MemoryBlockConfig;
        [key: string]: MemoryBlockConfig | undefined;
    };
    Compression?: MemoryCompressionConfig;
    // Extract?: Config["Memory"]["Extract"];
    Backup?: BackupConfig;
    UseModel?: ModelDescriptor;
}
