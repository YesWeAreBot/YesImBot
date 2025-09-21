import { Context, Logger } from "koishi";
import { v4 as uuidv4 } from "uuid";

import { Config } from "@/config";
import { IEmbedModel } from "@/services/model";
import { Services, TableName } from "@/shared/constants";
import { cosineSimilarity } from "@/shared/utils";
import { ContextualMessage, MemoryChunkData, MessageData } from "./types";

export class SemanticMemoryManager {
    private ctx: Context;
    private config: Config;
    private logger: Logger;
    private embedModel: IEmbedModel;
    private messageBuffer: Map<string, MessageData[]> = new Map();
    private isRebuilding: boolean = false;

    constructor(ctx: Context, config: Config) {
        this.ctx = ctx;
        this.config = config;
        this.logger = ctx[Services.Logger].getLogger("[语义记忆]");
    }

    public start() {
        try {
            this.embedModel = this.ctx[Services.Model].getEmbedModel(this.config.embeddingModel);
        } catch (error) {
            this.logger.debug(`获取嵌入模型失败: ${error?.message || "未知错误"}`);
            this.embedModel = null;
        }
        if (!this.embedModel) this.logger.warn("未找到任何可用的嵌入模型，记忆功能将受限");
    }

    public stop() {
        this.flushAllBuffers();
    }

    public async addMessageToBuffer(message: MessageData): Promise<void> {
        if (!this.config.l2_memory.enabled) return;

        const { channelId } = message;
        if (!this.messageBuffer.has(channelId)) {
            this.messageBuffer.set(channelId, []);
        }

        const buffer = this.messageBuffer.get(channelId);
        buffer.push(message);

        if (buffer.length >= this.config.l2_memory.messagesPerChunk) {
            const chunkToProcess = buffer.splice(0, this.config.l2_memory.messagesPerChunk);
            await this.processMessageBatch(chunkToProcess);
        }
    }

    public async flushBuffer(channelId: string): Promise<void> {
        if (this.messageBuffer.has(channelId)) {
            const buffer = this.messageBuffer.get(channelId);
            if (buffer.length > 0) {
                await this.processMessageBatch(buffer);
                this.messageBuffer.set(channelId, []);
            }
        }
    }

    private async flushAllBuffers(): Promise<void> {
        for (const channelId of this.messageBuffer.keys()) {
            await this.flushBuffer(channelId);
        }
    }

    private async processMessageBatch(messages: MessageData[]): Promise<void> {
        if (!this.embedModel || messages.length === 0) return;

        const firstEvent = messages[0];
        const lastEvent = messages[messages.length - 1];
        const { platform, channelId } = firstEvent;

        const participantIds = [...new Set(messages.map((m) => m.sender.id))];

        const conversationText = this.compileEventsToText(messages);

        try {
            const embedding = await this.embedModel.embed(conversationText);
            const memoryChunk: MemoryChunkData = {
                id: uuidv4(),
                platform,
                channelId,
                content: conversationText,
                embedding: embedding.embedding,
                participantIds,
                startTimestamp: firstEvent.timestamp,
                endTimestamp: lastEvent.timestamp,
            };
            await this.ctx.database.create(TableName.L2Chunks, memoryChunk);
            this.logger.debug(`已为 ${messages.length} 条消息建立索引`);
        } catch (error) {
            this.logger.error(`消息索引创建失败 | ${error.message}`);
            this.logger.debug(error);
        }
    }

    /**
     * 根据查询文本检索相关的记忆片段。
     * 1. 高效获取候选池：一次性加载所有相关chunks，在内存中计算相似度，避免全表扫描和N+1查询。
     * 2. 精确近邻扩展：对Top-K候选块，在内存时间线中查找前后邻居。
     * 3. 智能合并：将所有相关（候选+邻居）且时间连续的块分组，并按“头取半、尾取半、中间全取”的规则合并，确保上下文完整且无冗余。
     * 4. 向量兼容性处理：自动检测并处理因更换模型导致的向量维度不一致问题，通过后台任务重建索引。
     * @param queryText - 查询文本
     * @param options - 查询选项
     * @returns 按时间顺序排列的、经过合并优化的记忆块列表。
     */
    public async search(
        queryText: string,
        options?: { platform?: string; channelId?: string; k?: number; startTimestamp?: Date; endTimestamp?: Date }
    ): Promise<(MemoryChunkData & { similarity: number })[]> {
        if (!this.embedModel) return [];

        const k = options?.k || 5;
        const minAllowedSim = this.config.l2_memory.retrievalMinSimilarity ?? 0.5;

        const queryEmbedding = await this.embedModel.embed(queryText);
        const expectedDim = queryEmbedding.embedding.length;

        const allChunks = await this.ctx.database.get(TableName.L2Chunks, {
            platform: options?.platform || {},
            channelId: options?.channelId || {},
            startTimestamp: { $gte: options?.startTimestamp || new Date(0) },
            endTimestamp: { $lte: options?.endTimestamp || new Date() },
        });

        if (allChunks.length === 0) return [];

        const validChunks = allChunks.filter((c) => c.embedding?.length === expectedDim);
        if (validChunks.length < allChunks.length) {
            this.rebuildIndex();
        }

        if (validChunks.length === 0) return [];

        // 按时间升序排序，构建完整的时间线
        allChunks.sort((a, b) => new Date(a.startTimestamp).getTime() - new Date(b.startTimestamp).getTime());

        const chunkIndexMap = new Map<string, number>();
        const chunkMap = new Map<string, MemoryChunkData>();
        allChunks.forEach((chunk, index) => {
            chunkIndexMap.set(chunk.id, index);
            chunkMap.set(chunk.id, chunk);
        });

        const resultsWithSimilarity = validChunks.map((chunk) => ({
            ...chunk,
            similarity: cosineSimilarity(queryEmbedding.embedding, chunk.embedding),
        }));

        resultsWithSimilarity.sort((a, b) => b.similarity - a.similarity);

        const candidateChunks = resultsWithSimilarity.slice(0, k).filter((c) => c.similarity >= minAllowedSim);

        const finalChunkIds = new Set<string>();
        for (const chunk of candidateChunks) {
            finalChunkIds.add(chunk.id);
            const currentIndex = chunkIndexMap.get(chunk.id);

            if (currentIndex === undefined) continue;

            if (currentIndex > 0) finalChunkIds.add(allChunks[currentIndex - 1].id);
            if (currentIndex < allChunks.length - 1) finalChunkIds.add(allChunks[currentIndex + 1].id);
        }

        // 从包含相似度的结果中找回块，若邻居块是无效块，则其没有相似度
        const similarityMap = new Map(resultsWithSimilarity.map((c) => [c.id, c.similarity]));
        const finalChunks = Array.from(finalChunkIds)
            .map((id) => {
                const chunk = chunkMap.get(id);
                if (!chunk) return null;
                return {
                    ...chunk,
                    similarity: similarityMap.get(id) || 0, // 无效块或非候选块的邻居相似度为0
                };
            })
            .filter(Boolean) as (MemoryChunkData & { similarity: number })[];

        finalChunks.sort((a, b) => new Date(a.startTimestamp).getTime() - new Date(b.startTimestamp).getTime());

        return this.groupAndMergeChunks(finalChunks, chunkIndexMap);
    }

    /**
     * 将一组按时间排序的记忆块进行分组和合并。
     * 只有在全局时间线上连续的块才会被分到同一组并合并。
     * @param chunks - 待处理的、已按时间排序的记忆块（候选块+邻居）
     * @param chunkIndexMap - 全局块ID到其在时间线上索引的映射
     * @returns 合并后的记忆块列表
     */
    private groupAndMergeChunks(
        chunks: (MemoryChunkData & { similarity: number })[],
        chunkIndexMap: Map<string, number>
    ): (MemoryChunkData & { similarity: number })[] {
        if (chunks.length === 0) return [];

        const groups: (MemoryChunkData & { similarity: number })[][] = [];
        let currentGroup: (MemoryChunkData & { similarity: number })[] = [];

        for (const chunk of chunks) {
            if (currentGroup.length === 0) {
                currentGroup.push(chunk);
            } else {
                const lastChunkInGroup = currentGroup[currentGroup.length - 1];
                const lastChunkIndex = chunkIndexMap.get(lastChunkInGroup.id)!;
                const currentChunkIndex = chunkIndexMap.get(chunk.id)!;

                // 检查当前块是否是上一块在全局时间线上的直接后继
                if (currentChunkIndex === lastChunkIndex + 1) {
                    currentGroup.push(chunk);
                } else {
                    // 不连续，开启新分组
                    groups.push(currentGroup);
                    currentGroup = [chunk];
                }
            }
        }
        // 推入最后一个分组
        if (currentGroup.length > 0) {
            groups.push(currentGroup);
        }

        const mergedResults: (MemoryChunkData & { similarity: number })[] = [];

        for (const group of groups) {
            // 如果分组只有一个块，或者说它是一个孤立的上下文片段，则不进行内容裁切，直接保留
            if (group.length <= 1) {
                mergedResults.push(...group);
                continue;
            }

            // 对包含多个连续块的分组进行合并
            const firstChunk = group[0];
            const lastChunk = group[group.length - 1];
            const middleChunks = group.slice(1, -1);

            // 定义内容分割函数
            const splitContent = (content: string, takeFirstHalf: boolean): string => {
                const lines = content.split("\n").filter((line) => line.trim() !== "");
                if (lines.length <= 1) return content;
                const midPoint = Math.ceil(lines.length / 2);
                return takeFirstHalf ? lines.slice(0, midPoint).join("\n") : lines.slice(midPoint).join("\n");
            };

            const mergedContentParts: string[] = [];
            mergedContentParts.push(splitContent(firstChunk.content, false));
            middleChunks.forEach((chunk) => mergedContentParts.push(chunk.content));
            mergedContentParts.push(splitContent(lastChunk.content, true));

            const mergedContent = mergedContentParts.join("\n");
            const maxSimilarity = Math.max(...group.map((chunk) => chunk.similarity));

            mergedResults.push({
                ...firstChunk,
                id: `merged-${firstChunk.id}-${lastChunk.id}`,
                endTimestamp: lastChunk.endTimestamp,
                content: mergedContent,
                similarity: maxSimilarity,
                embedding: firstChunk.embedding,
            });
        }

        return mergedResults;
    }

    public compileEventsToText(messages: (MessageData | ContextualMessage)[]): string {
        return messages.map((m) => `${m.sender.name || m.sender.id}: ${m.content}`).join("\n");
    }

    /**
     * 重建所有 L2 记忆片段的向量索引。
     * 增加状态锁，防止多个重建任务同时运行。
     */
    public async rebuildIndex() {
        if (this.isRebuilding) {
            this.logger.info("索引重建任务已在后台运行，本次请求被跳过");
            return;
        }
        if (!this.embedModel) {
            this.logger.warn("无可用嵌入模型，无法重建索引");
            return;
        }

        this.isRebuilding = true;
        this.logger.info("开始重建 L2 记忆索引...");

        try {
            const allChunks = await this.ctx.database.get(TableName.L2Chunks, {});
            let successCount = 0;
            let failCount = 0;

            for (const chunk of allChunks) {
                try {
                    const result = await this.embedModel.embed(chunk.content);
                    await this.ctx.database.set(TableName.L2Chunks, { id: chunk.id }, { embedding: result.embedding });
                    successCount++;
                } catch (error) {
                    failCount++;
                    this.logger.error(`重建块 ${chunk.id} 的索引失败 | ${error.message}`);
                }
            }
            this.logger.info(`L2 记忆索引重建完成。成功: ${successCount}，失败: ${failCount}。`);
        } catch (error) {
            this.logger.error(`索引重建过程中发生严重错误: ${error.message}`);
        } finally {
            this.isRebuilding = false; // 确保在任务结束或失败时解锁
        }
    }
}
