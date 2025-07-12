import { IEmbedModel, TaskType } from "@/services/model";
import { Services } from "@/services/types";
import { AppError, ErrorCodes } from "@/shared/errors";
import { Context, Logger } from "koishi";
import Mustache from "mustache";
import { randomUUID } from "node:crypto";
import { ARCHIVAL_MEMORY_TABLE } from "./config";
import { ArchivalEntry, ArchivalMemoryData, ArchivalSearchResult } from "./types";

/**
 * 归档记忆存储接口
 */
export interface IArchivalMemoryStore {
    /**
     * 存储一条新的记忆。
     * @param content 记忆的文本内容。
     * @param metadata 可选的元数据，用于过滤。
     * @returns 存储成功后的记忆条目（不含 embedding）。
     */
    store(content: string, metadata?: Record<string, any>): Promise<ArchivalEntry>;

    /**
     * 根据 ID 检索一条记忆。
     * @param id 记忆的唯一 ID。
     * @returns 找到的记忆条目，如果不存在则返回 null。
     */
    retrieve(id: string): Promise<ArchivalEntry | null>;

    /**
     * 更新一条已存在的记忆。
     * @param id 要更新的记忆 ID。
     * @param data 包含要更新的内容和/或元数据的对象。
     *           如果提供了 content，将重新计算并更新 embedding。
     * @returns 更新后的记忆条目，如果不存在则返回 null。
     */
    update(id: string, data: { content?: string; metadata?: Record<string, any> }): Promise<ArchivalEntry | null>;

    /**
     * 根据文本查询或元数据过滤来搜索相关记忆。
     * @param query 搜索的文本查询。
     * @param options 搜索选项，如 topK、元数据过滤器和相似度阈值。
     * @returns 搜索结果。
     */
    /* prettier-ignore */
    search(query: string, options?: { topK?: number; filterMetadata?: Record<string, any>; similarityThreshold?: number }): Promise<ArchivalSearchResult>;

    /**
     * 根据 ID 删除一条记忆。
     * @param id 要删除的记忆 ID。
     * @returns 如果成功删除则返回 true，否则返回 false。
     */
    remove(id: string): Promise<boolean>;

    /**
     * 获取存储中的记忆总数。
     * @returns 记忆总数。
     */
    count(): Promise<number>;

    /**
     * 清空所有归档记忆。
     */
    clearAll(): Promise<void>;

    /**
     * 为所有记忆重新生成并更新 embedding。
     * 更换嵌入模型后需要调用此方法。
     */
    rebuildEmbeddings(): Promise<{ successCount: number; failCount: number }>;
}

/**
 * 基于 Koishi 数据库和向量搜索的归档记忆存储实现。
 *
 * @warning 默认的向量搜索是在应用内存中进行的，它会从数据库加载所有条目（或经过元数据过滤的条目），
 *          然后在内存中计算相似度。这种方法不适用于大规模数据集。
 *          为了实现生产级别的性能和可扩展性，强烈建议使用支持原生向量搜索的数据库后端，
 *          例如带有 pgvector 扩展的 PostgreSQL，并修改 `search` 方法以利用其原生查询能力。
 */
export class BasicArchivalStore implements IArchivalMemoryStore {
    private readonly ctx: Context;
    private readonly logger: Logger;
    private readonly embedder: IEmbedModel;

    constructor(ctx: Context) {
        this.ctx = ctx;
        this.logger = ctx[Services.Logger].getLogger("[记忆服务] [归档存储]");

        // 确保嵌入模型可用
        this.embedder = ctx[Services.Model].useEmbeddingGroup(TaskType.Embedding)?.current;
        if (!this.embedder) {
            this.logger.error("未找到可用的嵌入模型，归档记忆存储将不可用。");
        }
    }

    /**
     * 计算两个向量之间的余弦相似度。
     */
    private _cosineSimilarity(vecA: number[], vecB: number[]): number {
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

    async store(content: string, metadata?: Record<string, any>): Promise<ArchivalEntry> {
        if (!this.embedder) {
            throw new AppError("嵌入模型不可用，无法存储记忆。", { code: ErrorCodes.SERVICE.UNAVAILABLE });
        }
        try {
            this.logger.debug(`正在为内容生成 embedding...`);
            const embedding = await this.embedder.embed(content);

            const id = randomUUID();
            const timestamp = new Date();

            const entry: ArchivalMemoryData = { id, content, timestamp, metadata: metadata ?? {}, embedding: embedding.embedding };

            await this.ctx.database.create(ARCHIVAL_MEMORY_TABLE, entry);

            this.logger.debug(`已存储归档记忆，ID: ${id}`);
            const { embedding: _, ...publicEntry } = entry;
            return publicEntry;
        } catch (error) {
            this.logger.error(`存储归档记忆失败: ${error.message}`);
            this.logger.debug(error.stack);
            throw new AppError("存储归档记忆失败", {
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

    async update(id: string, data: { content?: string; metadata?: Record<string, any> }): Promise<ArchivalEntry | null> {
        const [entryToUpdate] = await this.ctx.database.get(ARCHIVAL_MEMORY_TABLE, { id });
        if (!entryToUpdate) {
            this.logger.warn(`尝试更新一个不存在的记忆: ${id}`);
            return null;
        }

        const updates: Partial<ArchivalMemoryData> = {};

        // 如果提供了新内容，则更新内容并重新计算 embedding
        if (data.content && data.content !== entryToUpdate.content) {
            if (!this.embedder) {
                throw new AppError("嵌入模型不可用，无法更新记忆内容。", { code: ErrorCodes.SERVICE.UNAVAILABLE });
            }
            this.logger.debug(`内容已更改，为记忆 ${id} 重新生成 embedding...`);
            const embeddingResult = await this.embedder.embed(data.content);
            updates.content = data.content;
            updates.embedding = embeddingResult.embedding;
        }

        // 如果提供了新元数据，则更新元数据 (这里是替换，也可以设计为合并)
        if (data.metadata) {
            updates.metadata = data.metadata;
        }

        // 如果没有任何更新，直接返回
        if (Object.keys(updates).length === 0) {
            this.logger.debug(`无需更新记忆 ${id}。`);
            const { embedding: _, ...publicEntry } = entryToUpdate;
            return publicEntry;
        }

        updates.timestamp = new Date(); // 更新时间戳

        await this.ctx.database.set(ARCHIVAL_MEMORY_TABLE, { id }, updates);
        this.logger.debug(`已更新记忆 ${id}`);

        // 返回更新后的公开条目
        const updatedEntry = { ...entryToUpdate, ...updates };
        const { embedding: _, ...publicEntry } = updatedEntry;
        return publicEntry;
    }

    async search(
        query: string,
        options: { topK?: number; filterMetadata?: Record<string, any>; similarityThreshold?: number } = {}
    ): Promise<ArchivalSearchResult> {
        const { topK = 10, filterMetadata, similarityThreshold = 0 } = options;
        if (!this.embedder) {
            throw new AppError("嵌入模型不可用，无法搜索记忆。", { code: ErrorCodes.SERVICE.UNAVAILABLE });
        }

        try {
            this.logger.debug(`正在为查询 "${query}" 生成 embedding...`);
            const queryEmbedding = await this.embedder.embed(query);

            // 元数据过滤在数据库层面执行，以减少加载到内存的数据量
            const allEntries = await this.ctx.database.get(ARCHIVAL_MEMORY_TABLE, filterMetadata ?? {});

            if (allEntries.length === 0) {
                return { results: [], total: 0 };
            }

            // 再次警告内存搜索的局限性
            if (allEntries.length > 500) {
                // 设置一个阈值以发出更强烈的警告
                /* prettier-ignore */
                this.logger.warn(`正在对 ${allEntries.length} 条记忆执行内存向量搜索。这可能非常缓慢且消耗大量内存。请考虑升级到支持原生向量搜索的数据库后端。`);
            }

            // 维度检查
            if (queryEmbedding.embedding.length !== allEntries[0].embedding.length) {
                /* prettier-ignore */
                this.logger.error(`查询 embedding 维度 (${queryEmbedding.embedding.length}) 与存储的 embedding 维度 (${allEntries[0].embedding.length}) 不匹配。如果您更换了嵌入模型，请运行 rebuildEmbeddings() 方法重建索引。`);
                return { results: [], total: 0 };
            }

            // 在内存中计算相似度、排序和过滤
            const scoredEntries = allEntries
                .map((entry) => ({
                    entry,
                    score: this._cosineSimilarity(queryEmbedding.embedding, entry.embedding),
                }))
                .filter((item) => item.score >= similarityThreshold);

            scoredEntries.sort((a, b) => b.score - a.score);

            const topResults = scoredEntries.slice(0, topK);

            // 准备返回结果，移除 embedding 字段
            const publicResults = topResults.map((r) => {
                const { embedding: _, ...publicEntry } = r.entry;
                return { ...publicEntry, score: r.score };
            });

            this.logger.debug(`归档记忆搜索到 ${publicResults.length} 个结果。`);

            return { results: publicResults, total: await this.count() };
        } catch (error) {
            this.logger.error(`搜索归档记忆失败: ${error.message}`);
            throw new AppError("搜索归档记忆失败", {
                code: ErrorCodes.RESOURCE.STORAGE_FAILURE,
                cause: error,
            });
        }
    }

    async remove(id: string): Promise<boolean> {
        const result = await this.ctx.database.remove(ARCHIVAL_MEMORY_TABLE, { id });
        if (result.removed > 0) {
            this.logger.debug(`已删除记忆: ${id}`);
            return true;
        }
        return false;
    }

    async count(): Promise<number> {
        // 不支持 count 操作
        return this.ctx.database.get(ARCHIVAL_MEMORY_TABLE, {}).then((results) => results.length);
    }

    async clearAll(): Promise<void> {
        await this.ctx.database.remove(ARCHIVAL_MEMORY_TABLE, {});
        this.logger.info("已清空所有归档记忆。");
    }

    public async rebuildEmbeddings(): Promise<{ successCount: number; failCount: number }> {
        if (!this.embedder) {
            this.logger.error("嵌入模型不可用，无法重建 embeddings。");
            return;
        }
        this.logger.info("开始为所有归档记忆重新生成 embedding...");
        const allEntries = await this.ctx.database.get(ARCHIVAL_MEMORY_TABLE, {});
        let successCount = 0;
        let failCount = 0;

        for (const entry of allEntries) {
            try {
                const embedding = await this.embedder.embed(entry.content);
                await this.ctx.database.set(ARCHIVAL_MEMORY_TABLE, { id: entry.id }, { embedding: embedding.embedding });
                successCount++;
            } catch (error) {
                failCount++;
                this.logger.error(`为记忆 ${entry.id} 重新生成 embedding 失败: ${error.message}`);
            }
        }
        this.logger.info(`Embedding 重建完成。成功: ${successCount}, 失败: ${failCount}。`);
        return { successCount, failCount };
    }

    public renderEntryText(entry: ArchivalEntry & { score?: number }): string {
        const template = `{{#entry}}
<memory id="{{id}}" timestamp="{{timestamp}}"{{#score}} score="{{score}}"{{/score}}>
    {{#metadata}}
    <metadata>{{_toString}}</metadata>
    {{/metadata}}
    <content>{{content}}</content>
</memory>
{{/entry}}`;
        return Mustache.render(template, { entry });
    }
}
