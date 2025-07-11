/**
 * 记忆块的元数据，存储在文件的 YAML Front Matter 中。
 */
export interface MemoryBlockMetadata {
    title: string;
    label: string;
    description: string;
    limit: number;
}

/**
 * 内存中一个记忆块的完整数据表示。
 */
export interface MemoryBlockData extends MemoryBlockMetadata {
    content: string[];
}

/**
 * 归档记忆条目的数据结构。
 */
export interface ArchivalEntry {
    id: string;
    content: string;
    timestamp: Date;
    metadata?: Record<string, any>;
}

/**
 * 归档记忆的数据库存储模型，包含 embedding 向量。
 */
export interface ArchivalMemoryData extends ArchivalEntry {
    embedding: number[];
}

/**
 * 归档记忆的搜索结果。
 */
export interface ArchivalSearchResult {
    results: ArchivalEntry[];
    total: number;
}