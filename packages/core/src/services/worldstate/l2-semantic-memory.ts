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
            this.logger.error(`创建记忆片段失败`, error);
        }
    }

    /**
     * 根据查询文本检索相关的记忆片段（Top-K+近邻扩展）
     * 查询结果按时间戳升序排列，以保持上下文连续
     * 若启用了`includeNeighborChunks`，则会扩展前后相邻的记忆片段
     * 返回结果可能大于k
     * @param queryText - 查询文本
     * @param k - 默认为5
     * @returns
     */
    public async search(
        queryText: string,
        options?: { platform?: string; channelId?: string; k?: number; earliestMessageTimestamp?: Date }
    ): Promise<(MemoryChunkData & { similarity: number })[]> {
        if (!this.embedModel) return [];

        const queryEmbedding = await this.embedModel.embed(queryText);

        // 取出所有记忆片段
        const results = await this.ctx.database.get(TableName.L2Chunks, {
            platform: options?.platform || {},
            channelId: options?.channelId || {},
            endTimestamp: { $lte: options?.earliestMessageTimestamp || new Date() },
        });

        // 计算相似度
        const resultsWithSimilarity = results.map((chunk) => ({
            ...chunk,
            similarity: cosineSimilarity(queryEmbedding.embedding, chunk.embedding),
        }));

        // 按相似度降序
        resultsWithSimilarity.sort((a, b) => b.similarity - a.similarity);

        // 先拿Top-K（候选池）
        const candidateChunks = resultsWithSimilarity.slice(0, options?.k || 5);

        // 设置最低阈值，过滤极端不相关的
        const minAllowedSim = this.config.l2_memory.retrievalMinSimilarity ?? 0.5;
        const filteredResults = candidateChunks.filter((c) => c.similarity >= minAllowedSim);

        // ===== 新增：相邻chunk扩展 =====
        const expandedResults: (MemoryChunkData & { similarity: number })[] = [];
        const seenIds = new Set<string>();

        for (const chunk of filteredResults) {
            if (!seenIds.has(chunk.id)) {
                expandedResults.push(chunk);
                seenIds.add(chunk.id);
            }

            // 查找前后相邻chunk（时间上），保证上下文完整
            const neighbors = await this.ctx.database.get(
                TableName.L2Chunks,
                {
                    platform: chunk.platform,
                    channelId: chunk.channelId,
                    startTimestamp: { $lt: chunk.startTimestamp },
                },
                { sort: { startTimestamp: "desc" }, limit: 1 }
            );

            const nextNeighbors = await this.ctx.database.get(
                TableName.L2Chunks,
                {
                    channelId: chunk.channelId,
                    startTimestamp: { $gt: chunk.startTimestamp },
                },
                { sort: { startTimestamp: "asc" }, limit: 1 }
            );

            // 合并相邻块进结果
            [...neighbors, ...nextNeighbors].forEach((nb) => {
                if (!seenIds.has(nb.id)) {
                    expandedResults.push({ ...nb, similarity: chunk.similarity * 0.95 /* 附加块打点分 */ });
                    seenIds.add(nb.id);
                }
            });
        }

        // 最后按相似度降序返回（相邻chunk会稍微降分）
        // expandedResults.sort((a, b) => b.similarity - a.similarity);

        // 最后按时间戳升序返回，以保持上下文连续
        // expandedResults.sort((a, b) => a.startTimestamp.getTime() - b.startTimestamp.getTime());

        const mergedResults = this.mergeAdjacentChunks(expandedResults, 5);

        return mergedResults;
    }

    /**
     * 把时间连续且间隔小、并且来自邻居扩展的 chunk 合并成一个大块
     * @param chunks
     * @param timeGapLimitSec
     * @returns
     */
    private mergeAdjacentChunks(
        chunks: (MemoryChunkData & { similarity: number })[],
        timeGapLimitSec = 120
    ): (MemoryChunkData & { similarity: number })[] {
        if (chunks.length === 0) return [];

        // 按时间升序
        chunks.sort((a, b) => new Date(a.startTimestamp).getTime() - new Date(b.startTimestamp).getTime());

        const merged: (MemoryChunkData & { similarity: number })[] = [];
        let buffer = { ...chunks[0] };

        for (let i = 1; i < chunks.length; i++) {
            const curr = chunks[i];
            const prev = buffer;

            const gapSec = (new Date(curr.startTimestamp).getTime() - new Date(prev.endTimestamp).getTime()) / 1000;

            // 如果是同一个channel，且间隔小于阈值，则认为是连续的对话
            if (curr.channelId === prev.channelId && gapSec <= timeGapLimitSec) {
                buffer.content += "\n" + curr.content;
                // endTimestamp 更新为当前块的
                buffer.endTimestamp = curr.endTimestamp;
                // 相似度可以取较高值或平均
                buffer.similarity = Math.max(buffer.similarity, curr.similarity);
            } else {
                merged.push(buffer);
                buffer = { ...curr };
            }
        }
        merged.push(buffer);

        return merged;
    }

    public compileEventsToText(messages: (MessageData | ContextualMessage)[]): string {
        return messages.map((m) => `${m.sender.name || m.sender.id}: ${m.content}`).join("\n");
    }

    public async getLatestMemoryTimestamp(channelId: string): Promise<Date> {
        const latestChunks = await this.ctx.database.get(TableName.L2Chunks, { channelId }, { limit: 1, sort: { endTimestamp: "desc" } });
        return latestChunks.length > 0 ? latestChunks[0].endTimestamp : new Date(0);
    }
}
