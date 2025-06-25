export interface MemoryBlockData {
    id: string;
    label: string;
    content: string[];
    limit: number;
}

export interface MemoryBlockCompressionState {
    messageCount: number; // 用于 IntervalMessages 计数
    lastCompressionTime: Date; // 用于 IntervalMinutes 计数
}

export interface ArchivalEntry {
    id: string;
    content: string;
    timestamp: Date;
    metadata?: Record<string, any>;
}

export interface ArchivalSearchResult {
    results: ArchivalEntry[];
    total: number;
}
