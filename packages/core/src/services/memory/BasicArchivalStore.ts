import { IEmbedModel, TaskType } from "@/services/model";
import { Services } from "@/services/types";
import { AppError, ErrorCodes } from "@/shared/errors";
import { Context, Logger } from "koishi";
import { ARCHIVAL_MEMORY_TABLE } from "./config";
import { ArchivalEntry, ArchivalMemoryData, ArchivalSearchResult } from "./types";

/**
 * 归档记忆存储接口
 */
export interface IArchivalMemoryStore {
    store(content: string, metadata?: Record<string, any>): Promise<ArchivalEntry>;
    retrieve(id: string): Promise<ArchivalEntry | null>;
    search(query: string, options?: { topK?: number; filterMetadata?: Record<string, any> }): Promise<ArchivalSearchResult>;
    remove(id: string): Promise<boolean>;
    count(): Promise<number>;
    clearAll(): Promise<void>;
    renderEntryText(entry: ArchivalEntry): string;
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 基于数据库和向量搜索的归档记忆存储实现
 */
export class BasicArchivalStore implements IArchivalMemoryStore {
    private readonly logger: Logger;

    private readonly embedder: IEmbedModel;

    constructor(private readonly ctx: Context) {
        this.logger = ctx[Services.Logger].getLogger("[记忆服务] [归档存储]");

        this.embedder = this.ctx[Services.Model].useEmbeddingGroup(TaskType.Embedding)?.getCurrent();

        if (!this.embedder) {
            this.logger.error("未找到可用的嵌入模型，归档记忆存储将不可用。");
        }
    }

    async store(content: string, metadata?: Record<string, any>): Promise<ArchivalEntry> {
        try {
            this.logger.debug(`正在为内容生成 embedding...`);
            const embedding = await this.embedder.embed(content);
            const id = `archival-mem-${Date.now()}-${Math.random().toString(36).substring(2)}`;
            const timestamp = new Date();

            const entry: ArchivalMemoryData = { id, content, timestamp, metadata, embedding: embedding.embedding };

            await this.ctx.database.create(ARCHIVAL_MEMORY_TABLE, entry);

            this.logger.debug(`已存储归档记忆，ID: ${id}`);
            // 返回不包含 embedding 的公共对象
            const { embedding: _, ...publicEntry } = entry;
            return publicEntry;
        } catch (error) {
            this.logger.error(`存储归档记忆失败: ${error.message}`);
            throw new AppError("Failed to store archival memory", {
                code: ErrorCodes.RESOURCE.STORAGE_FAILURE,
                cause: error,
            });
        }
    }

    async retrieve(id: string): Promise<ArchivalEntry | null> {
        const [result] = await this.ctx.database.get(ARCHIVAL_MEMORY_TABLE, { id });
        if (!result) return null;
        const { embedding: _, ...publicEntry } = result;
        return publicEntry;
    }

    async search(query: string, options: { topK?: number; filterMetadata?: Record<string, any> } = {}): Promise<ArchivalSearchResult> {
        const { topK = 10, filterMetadata } = options;
        try {
            this.logger.debug(`正在为查询 "${query}" 生成 embedding...`);
            const queryEmbedding = await this.embedder.embed(query);

            this.logger.warn("正在执行内存向量搜索。此方法无法扩展到大量数据，仅建议用于小型或演示目的。");

            const allEntries = await this.ctx.database.get(ARCHIVAL_MEMORY_TABLE, filterMetadata ?? {});

            if (allEntries.length === 0) {
                return { results: [], total: 0 };
            }

            const scoredEntries = allEntries.map((entry) => ({
                entry,
                score: cosineSimilarity(queryEmbedding.embedding, entry.embedding),
            }));

            scoredEntries.sort((a, b) => b.score - a.score);

            const topResults = scoredEntries.slice(0, topK);

            const publicResults = topResults.map((r) => {
                const { embedding: _, ...publicEntry } = r.entry;
                return publicEntry;
            });

            const total = await this.count();
            this.logger.debug(`归档记忆搜索到 ${publicResults.length} 个结果 (总计 ${total} 条)。`);

            return { results: publicResults, total };
        } catch (error) {
            this.logger.error(`搜索归档记忆失败: ${error.message}`);
            throw new AppError("Failed to search archival memory", {
                code: ErrorCodes.RESOURCE.STORAGE_FAILURE,
                cause: error,
            });
        }
    }

    async remove(id: string): Promise<boolean> {
        const result = await this.ctx.database.remove(ARCHIVAL_MEMORY_TABLE, { id });
        return result.removed > 0;
    }

    async count(): Promise<number> {
        const stats = await this.ctx.database.stats();
        return stats.tables[ARCHIVAL_MEMORY_TABLE]?.count ?? 0;
    }

    async clearAll(): Promise<void> {
        await this.ctx.database.remove(ARCHIVAL_MEMORY_TABLE, {});
        this.logger.info("已清空所有归档记忆。");
    }

    renderEntryText(entry: ArchivalEntry): string {
        let text = `[Archival ID: ${entry.id}, Timestamp: ${entry.timestamp.toISOString()}]`;
        if (entry.metadata && Object.keys(entry.metadata).length > 0) {
            text += `\n  Metadata: ${JSON.stringify(entry.metadata)}`;
        }
        text += `\n  Content: ${entry.content}`;
        return text;
    }
}
