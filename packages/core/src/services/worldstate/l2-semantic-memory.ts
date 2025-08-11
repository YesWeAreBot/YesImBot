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
        if (!this.embedModel) this.logger.warn("未找到任何可用的嵌入模型，L2 记忆功能将受限");
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
     * 根据查询文本检索相关的记忆片段。
     * @param queryText - The text to search for.
     * @param k - The number of chunks to retrieve.
     * @returns A list of relevant memory chunks.
     */
    public async search(queryText: string, k: number): Promise<(MemoryChunkData & { similarity: number })[]> {
        if (!this.embedModel) return [];

        const queryEmbedding = await this.embedModel.embed(queryText);

        const results = await this.ctx.database.get(TableName.L2Chunks, {});

        const resultsWithSimilarity = results.map((chunk) => ({
            ...chunk,
            similarity: cosineSimilarity(queryEmbedding.embedding, chunk.embedding),
        }));

        resultsWithSimilarity.sort((a, b) => b.similarity - a.similarity);

        const minSimilarity = this.config.l2_memory.retrievalMinSimilarity;

        const filteredResults = resultsWithSimilarity.filter((result) => result.similarity >= minSimilarity);

        return filteredResults.slice(0, k);
    }

    public compileEventsToText(messages: (MessageData | ContextualMessage)[]): string {
        return messages.map((m) => `${m.sender.name || m.sender.id}: ${m.content}`).join("\n");
    }

    public async getLatestMemoryTimestamp(channelId: string): Promise<Date> {
        const latestChunks = await this.ctx.database.get(TableName.L2Chunks, { channelId }, { limit: 1, sort: { endTimestamp: "desc" } });
        return latestChunks.length > 0 ? latestChunks[0].endTimestamp : new Date(0);
    }
}
