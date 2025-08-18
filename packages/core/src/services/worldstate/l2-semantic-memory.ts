import { Context, Logger } from "koishi";

import { IEmbedModel, TaskType } from "@/services/model";
import { Services, TableName } from "@/shared/constants";
import { cosineSimilarity } from "@/shared/utils";
import { v4 as uuidv4 } from "uuid";
import { HistoryConfig } from "./config";
import { ContextualMessage, MemoryChunkData, MessageData } from "./types";

export class SemanticMemoryManager {
    private ctx: Context;
    private config: HistoryConfig;
    private logger: Logger;
    private embedModel: IEmbedModel;
    private messageBuffer: Map<string, MessageData[]> = new Map();

    constructor(ctx: Context, config: HistoryConfig) {
        this.ctx = ctx;
        this.config = config;
        this.logger = ctx[Services.Logger].getLogger("[L2-语义记忆]");
    }

    public start() {
        try {
            this.embedModel = this.ctx[Services.Model].useEmbeddingGroup(TaskType.Embedding).getModels()[0];
        } catch {
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

    /**
     * 将一批消息处理为单个 L2 记忆片段并存储。
     * @param messages - The batch of messages to process.
     */
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
            this.logger.debug(`消息批次已处理并存入 L2 记忆 | 包含 ${messages.length} 条消息`);
        } catch (error) {
            this.logger.error(`创建记忆片段失败 | ${error.message}`);
            this.logger.debug(error);
        }
    }

    /**
     * 根据查询文本检索相关的记忆片段。
     * 1. 高效获取候选池：一次性加载所有相关chunks，在内存中计算相似度，避免全表扫描和N+1查询。
     * 2. 精确近邻扩展：对Top-K候选块，在内存时间线中查找前后邻居。
     * 3. 智能合并：将所有相关（候选+邻居）且时间连续的块分组，并按“头取半、尾取半、中间全取”的规则合并，确保上下文完整且无冗余。
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

        // --- 步骤 1: 一次性加载数据并建立内存索引 ---
        const queryEmbedding = await this.embedModel.embed(queryText);

        // 一次性加载所有可能相关的chunks。这是本流程中唯一的一次数据库批量读取。
        const allChunks = await this.ctx.database.get(TableName.L2Chunks, {
            platform: options?.platform || {},
            channelId: options?.channelId || {},
            startTimestamp: { $gte: options?.startTimestamp || new Date(0) },
            endTimestamp: { $lte: options?.endTimestamp || new Date() },
        });

        if (allChunks.length === 0) return [];

        // 按时间升序排序，构建完整的时间线
        allChunks.sort((a, b) => new Date(a.startTimestamp).getTime() - new Date(b.startTimestamp).getTime());

        // 创建ID到索引和ID到块的映射，用于O(1)查找
        const chunkIndexMap = new Map<string, number>();
        const chunkMap = new Map<string, MemoryChunkData>();
        allChunks.forEach((chunk, index) => {
            chunkIndexMap.set(chunk.id, index);
            chunkMap.set(chunk.id, chunk);
        });

        // --- 步骤 2: 计算相似度并获取Top-K候选池 ---
        const resultsWithSimilarity = allChunks.map((chunk) => ({
            ...chunk,
            similarity: cosineSimilarity(queryEmbedding.embedding, chunk.embedding),
        }));

        resultsWithSimilarity.sort((a, b) => b.similarity - a.similarity);

        const candidateChunks = resultsWithSimilarity.slice(0, k).filter((c) => c.similarity >= minAllowedSim);

        // --- 步骤 3: 近邻扩展 ---
        const finalChunkIds = new Set<string>();

        for (const chunk of candidateChunks) {
            finalChunkIds.add(chunk.id);
            const currentIndex = chunkIndexMap.get(chunk.id);

            if (currentIndex === undefined) continue;

            // 扩展前一个块
            if (currentIndex > 0) {
                const prevChunk = allChunks[currentIndex - 1];
                finalChunkIds.add(prevChunk.id);
            }
            // 扩展后一个块
            if (currentIndex < allChunks.length - 1) {
                const nextChunk = allChunks[currentIndex + 1];
                finalChunkIds.add(nextChunk.id);
            }
        }

        // --- 步骤 4: 分组与合并 ---
        const finalChunks = Array.from(finalChunkIds)
            .map((id) => resultsWithSimilarity.find((c) => c.id === id)) // 从带相似度的结果中找回块
            .filter(Boolean) as (MemoryChunkData & { similarity: number })[];

        // 再次按时间排序，为合并做准备
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
                if (lines.length <= 1) return content; // 内容太少不分割
                const midPoint = Math.ceil(lines.length / 2);
                return takeFirstHalf ? lines.slice(0, midPoint).join("\n") : lines.slice(midPoint).join("\n");
            };

            const mergedContentParts: string[] = [];

            // 第一个块：取后半部分
            mergedContentParts.push(splitContent(firstChunk.content, false));
            // 中间块：取全部内容
            middleChunks.forEach((chunk) => mergedContentParts.push(chunk.content));
            // 最后一个块：取前半部分
            mergedContentParts.push(splitContent(lastChunk.content, true));

            const mergedContent = mergedContentParts.join("\n");

            // 合并块的相似度可以取组内最高的
            const maxSimilarity = Math.max(...group.map((chunk) => chunk.similarity));

            mergedResults.push({
                ...firstChunk, // 基础元数据来自第一个块
                id: `merged-${firstChunk.id}-${lastChunk.id}`, // 创建一个唯一的合并ID
                endTimestamp: lastChunk.endTimestamp,
                content: mergedContent,
                similarity: maxSimilarity,
                // 注意：embedding 此时会与 content 不匹配，如果需要后续处理，应重新生成或置空
                embedding: firstChunk.embedding, // 暂时保留第一个的，或设为null
            });
        }

        return mergedResults;
    }

    public compileEventsToText(messages: (MessageData | ContextualMessage)[]): string {
        return messages.map((m) => `${m.sender.name || m.sender.id}: ${m.content}`).join("\n");
    }

    public async rebuildIndex() {
        this.logger.info("正在重建 L2 记忆索引...");

        const allChunks = await this.ctx.database.get(TableName.L2Chunks, {});

        for (const chunk of allChunks) {
            try {
                const result = await this.embedModel.embed(chunk.content);
                chunk.embedding = result.embedding;
                await this.ctx.database.set(TableName.L2Chunks, { id: chunk.id }, { embedding: chunk.embedding });
            } catch (error) {}
        }
    }
}
