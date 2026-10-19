import { Context, Logger } from "koishi";
import { v4 as uuidv4 } from "uuid";

import type { LoggerService } from "../logger";
import { IEmbedModel, ModelService, TaskType } from "../model";
import { withUsageScope } from "../model/usage";
import { TableName } from "../shared/constants";
import { cosineSimilarity } from "../shared/utils";
import { HistoryConfig } from "./config";
import { clearConversationStates } from "./conversation-state";
import { historyCoordinator, withHistoryBarrier } from "./history-coordinator";
import { keywordRelevance, recallKeywordCandidates, recallTokens, withinRecallScope } from "./hybrid-recall";
import { ContextualMessage, HistoryChannelType, MemoryChunkData, MessageData } from "./types";

export type SemanticMemoryScope = { platform: string; channelId: string } | { type: "private" | "guild" | "all" };
export type MemorySearchResult = MemoryChunkData & { similarity: number; retrievalMethod: "semantic" | "keyword" | "hybrid" };
export type MemoryTarget = { platform: string; channelId: string; channelType?: HistoryChannelType };

function splitContent(content: string, takeFirstHalf: boolean): string {
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    if (lines.length <= 1) return content;
    const midPoint = Math.ceil(lines.length / 2);
    return takeFirstHalf ? lines.slice(0, midPoint).join("\n") : lines.slice(midPoint).join("\n");
}

export class SemanticMemoryManager {
    private ctx: Context;
    private config: HistoryConfig;
    private logger: Logger;
    private embedModel: IEmbedModel | null = null;
    private messageBuffer: Map<string, MessageData[]> = new Map();
    private isRebuilding: boolean = false;
    private channelTypes = new Map<string, HistoryChannelType>();
    private generations = new Map<string, number>();
    private activeClears = new Set<{ scope: SemanticMemoryScope; done: Promise<void> }>();
    private pendingWrites = new Set<{ target: MemoryTarget; done: Promise<unknown> }>();
    private pendingBatches = new Set<Promise<void>>();
    private readonly coordination: ReturnType<typeof historyCoordinator>;
    private stopped = false;
    private stopTask?: Promise<void>;

    constructor(
        ctx: Context,
        config: HistoryConfig,
        logging: LoggerService,
        private readonly model: ModelService,
    ) {
        this.ctx = ctx;
        this.config = config;
        this.coordination = historyCoordinator(ctx.database ?? ctx);
        this.channelTypes = this.coordination.channelTypes;
        this.generations = this.coordination.generations;
        this.activeClears = this.coordination.activeClears;
        this.pendingWrites = this.coordination.pendingWrites;
        this.coordination.buffers.add(new WeakRef(this.messageBuffer));
        this.logger = logging.getLogger("[L2-语义记忆]");
    }

    public start() {
        this.stopped = false;
        this.stopTask = undefined;
        try {
            this.embedModel = this.model.useEmbeddingGroup(TaskType.Embedding)?.getModels()[0] ?? null;
        } catch {
            this.embedModel = null;
        }
        if (!this.embedModel) this.logger.warn("未找到任何可用的嵌入模型，记忆功能将受限");
    }

    public stop(): Promise<void> {
        this.stopped = true;
        return (this.stopTask ??= (async () => {
            try {
                await this.flushAllBuffers();
            } finally {
                // 达到分块阈值的任务已不在缓冲中，也要等其嵌入和写入完成。
                while (this.pendingBatches.size) await Promise.allSettled(this.pendingBatches);
            }
        })());
    }

    private targetKey(target: MemoryTarget): string {
        return JSON.stringify([target.platform, target.channelId]);
    }

    public observeChannel(target: MemoryTarget, channelType: HistoryChannelType): void {
        this.channelTypes.set(this.targetKey(target), channelType);
    }

    private channelType(target: MemoryTarget): HistoryChannelType | undefined {
        return target.channelType || this.channelTypes.get(this.targetKey(target));
    }

    private matchesScope(target: MemoryTarget, scope: SemanticMemoryScope): boolean {
        if (!("type" in scope)) return target.platform === scope.platform && target.channelId === scope.channelId;
        return scope.type === "all" || this.channelType(target) === scope.type;
    }

    private generation(target: MemoryTarget, generations = this.generations): number {
        const type = this.channelType(target);
        return (generations.get("all") || 0) + (type ? generations.get(type) || 0 : 0) + (generations.get(this.targetKey(target)) || 0);
    }

    public getHistoryGeneration(target: MemoryTarget): number {
        return this.generation(target);
    }

    public async waitForHistoryClear(target: MemoryTarget): Promise<void> {
        let barriers = [...this.activeClears].filter((entry) => this.matchesScope(target, entry.scope));
        while (barriers.length) {
            await Promise.all(barriers.map((entry) => entry.done));
            barriers = [...this.activeClears].filter((entry) => this.matchesScope(target, entry.scope));
        }
    }

    /** Shared by every manager using this physical database, including other instances. */
    public watchHistory(target: MemoryTarget, invalidate: () => void): () => void {
        const entry = { target, invalidate };
        this.coordination.invalidations.add(entry);
        return () => this.coordination.invalidations.delete(entry);
    }

    /** Retention removes only expired buffered messages; valid indexing work survives. */
    public pruneExpiredBuffers(cutoff: number): void {
        this.coordination.retentionCutoff = Math.max(this.coordination.retentionCutoff, cutoff);
        for (const reference of this.coordination.buffers) {
            const buffers = reference.deref();
            if (!buffers) {
                this.coordination.buffers.delete(reference);
                continue;
            }
            for (const [key, messages] of buffers) {
                const retained = this.unexpiredMessages(messages);
                if (retained.length) buffers.set(key, retained);
                else buffers.delete(key);
            }
        }
    }

    private unexpiredMessages(messages: MessageData[]): MessageData[] {
        return messages.filter((message) => new Date(message.timestamp).getTime() >= this.coordination.retentionCutoff);
    }

    /** 使旧任务失效，等待已发出的写入完成，并阻止新写入直到删除结束。 */
    public async clearHistory<T>(scope: SemanticMemoryScope, clear: () => Promise<T>): Promise<T> {
        const key = "type" in scope ? scope.type : this.targetKey(scope);
        this.generations.set(key, (this.generations.get(key) || 0) + 1);
        for (const entry of this.coordination.invalidations) if (this.matchesScope(entry.target, scope)) entry.invalidate();
        for (const reference of this.coordination.buffers) {
            const buffers = reference.deref();
            if (!buffers) {
                this.coordination.buffers.delete(reference);
                continue;
            }
            for (const [bufferKey, buffer] of buffers) {
                if (buffer.length && this.matchesScope(buffer[0], scope)) buffers.delete(bufferKey);
            }
        }

        return this.withHistoryBarrier(scope, async () => {
            await clearConversationStates(this.ctx.database, scope);
            return clear();
        });
    }

    /** Exclusive snapshot/maintenance without discarding buffers or changing generations. */
    public async withHistoryBarrier<T>(scope: SemanticMemoryScope, operation: () => Promise<T>): Promise<T> {
        return withHistoryBarrier(this.coordination, scope, operation);
    }

    public async writeMemory(target: MemoryTarget, generation: number, write: () => Promise<unknown>): Promise<boolean> {
        if (this.generation(target) !== generation) return false;
        let barriers = [...this.activeClears].filter((entry) => this.matchesScope(target, entry.scope));
        while (barriers.length) {
            await Promise.all(barriers.map((entry) => entry.done));
            if (this.generation(target) !== generation) return false;
            barriers = [...this.activeClears].filter((entry) => this.matchesScope(target, entry.scope));
        }
        // 版本检查与数据库写入登记之间不能 await，避免清理漏掉已发出的写入。
        const entry = { target, done: write() };
        this.pendingWrites.add(entry);
        try {
            await entry.done;
            return true;
        } finally {
            this.pendingWrites.delete(entry);
        }
    }

    public async addMessageToBuffer(message: MessageData): Promise<void> {
        if (this.stopped || !this.config.l2_memory.enabled || !this.unexpiredMessages([message]).length) return;
        const key = this.targetKey(message);
        if (!this.messageBuffer.has(key)) this.messageBuffer.set(key, []);
        const buffer = this.messageBuffer.get(key)!;
        buffer.push(message);

        if (buffer.length >= this.config.l2_memory.messagesPerChunk) {
            const chunkToProcess = buffer.splice(0, this.config.l2_memory.messagesPerChunk);
            await this.processMessageBatch(chunkToProcess);
        }
    }

    // 保持仅传频道 ID 的公用 API：未指定平台时，分别处理各平台的缓冲。
    public async flushBuffer(channelId: string, platform?: string): Promise<void> {
        const keys = [...this.messageBuffer]
            .filter(([, buffer]) => buffer.length && buffer[0].channelId === channelId && (!platform || buffer[0].platform === platform))
            .map(([key]) => key);
        for (const key of keys) await this.flushBufferKey(key);
    }

    private async flushBufferKey(key: string): Promise<void> {
        const buffer = this.messageBuffer.get(key);
        if (!buffer?.length) return;
        // 嵌入前先取走缓冲，避免 await 期间新消息被后续清空。
        this.messageBuffer.delete(key);
        await this.processMessageBatch(buffer);
    }

    private async flushAllBuffers(): Promise<void> {
        for (const key of [...this.messageBuffer.keys()]) await this.flushBufferKey(key);
    }

    private processMessageBatch(messages: MessageData[]): Promise<void> {
        const task = this.indexMessageBatch(messages);
        this.pendingBatches.add(task);
        return task.finally(() => this.pendingBatches.delete(task));
    }

    private async indexMessageBatch(messages: MessageData[]): Promise<void> {
        if (!this.embedModel || messages.length === 0) return;
        const embedModel = this.embedModel;

        const target = messages[0];
        const generation = this.generation(target);
        let retained = this.unexpiredMessages(messages);
        try {
            // A retention pass can run while the provider embeds. Recompute both
            // the text and vector when it trimmed a mixed old/new batch.
            while (retained.length) {
                const firstEvent = retained[0];
                const lastEvent = retained[retained.length - 1];
                const { platform, channelId } = firstEvent;
                const conversationText = this.compileEventsToText(retained);
                const embedding = await withUsageScope({ platform, target: channelId, purpose: "L2记忆索引" }, () => embedModel.embed(conversationText));
                if (this.generation(target) !== generation) return;
                const current = this.unexpiredMessages(retained);
                if (current.length !== retained.length) {
                    retained = current;
                    continue;
                }
                const memoryChunk: MemoryChunkData = {
                    id: uuidv4(),
                    platform,
                    channelId,
                    content: conversationText,
                    embedding: embedding.embedding,
                    participantIds: [...new Set(retained.map((message) => message.sender.id))],
                    startTimestamp: firstEvent.timestamp,
                    endTimestamp: lastEvent.timestamp,
                };
                let retry = false;
                const saved = await this.writeMemory(firstEvent, generation, async () => {
                    // writeMemory may have waited for a retention barrier after
                    // the embed completed. Check its cutoff before issuing I/O.
                    const current = this.unexpiredMessages(retained);
                    if (current.length !== retained.length) {
                        retained = current;
                        retry = true;
                        return;
                    }
                    await this.ctx.database.create(TableName.L2Chunks, memoryChunk);
                });
                if (retry) continue;
                if (saved) this.logger.debug(`已为 ${retained.length} 条消息建立索引`);
                return;
            }
        } catch (error) {
            this.logger.error(`消息索引创建失败 | ${error.message}`);
            this.logger.debug(error);
        }
    }

    /**
     * 根据查询文本检索相关的记忆片段。
     * 1. 有界混合候选池：向量最多200块，完整会话范围内额外检索关键词块和真实消息来源。
     * 2. 精确近邻扩展：按配置对Top-K候选块，在各会话时间线中查找前后邻居。
     * 3. 智能合并：按会话连续性分组，保留命中块全文，仅裁切边缘上下文邻居。
     * 4. 向量兼容性处理：自动检测并处理因更换模型导致的向量维度不一致问题，通过后台任务重建索引。
     * @param queryText - 查询文本
     * @param options - 查询选项
     * @returns 按时间顺序排列的、经过合并优化的记忆块列表。
     */
    public async search(
        queryText: string,
        options?: { platform?: string; channelId?: string; k?: number; startTimestamp?: Date; endTimestamp?: Date },
    ): Promise<MemorySearchResult[]> {
        const requestedK = options?.k ?? 5;
        if (!Number.isFinite(requestedK) || requestedK <= 0 || typeof queryText !== "string" || !queryText.trim()) return [];
        const k = Math.min(12, Math.floor(requestedK));
        if (!k) return [];
        options ??= {};
        if (
            [options.startTimestamp, options.endTimestamp].some((date) => date && !Number.isFinite(date.getTime())) ||
            (options.startTimestamp && options.endTimestamp && options.startTimestamp > options.endTimestamp)
        )
            return [];
        queryText = queryText.slice(-2000);
        const minAllowedSim = this.config.l2_memory.retrievalMinSimilarity ?? 0.5;
        let vector: number[] | undefined;
        if (this.embedModel) {
            try {
                const result = await withUsageScope({ platform: options.platform, target: options.channelId, purpose: "L2记忆检索" }, () =>
                    this.embedModel!.embed(queryText),
                );
                if (!result.embedding.length || !result.embedding.every(Number.isFinite) || !result.embedding.some((value) => value !== 0))
                    throw new Error("无效检索向量");
                vector = result.embedding;
            } catch (error) {
                this.logger.warn(`L2 嵌入检索失败，降级为有界关键词检索: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (!this.embedModel && options.platform && options.channelId) this.logger.warn("L2 无可用嵌入模型，使用有界关键词/来源检索");
        const keywordChunks = await recallKeywordCandidates(this.ctx.database, queryText, options);
        if (!vector && !keywordChunks.length) return [];
        const semanticChunks = vector
            ? (
                  await this.ctx.database.get(
                      TableName.L2Chunks,
                      {
                          platform: options.platform || {},
                          channelId: options.channelId || {},
                          startTimestamp: { $gte: options.startTimestamp || new Date(0) },
                          endTimestamp: { $lte: options.endTimestamp || new Date() },
                      },
                      { limit: 200, sort: { endTimestamp: "desc" } },
                  )
              )
                  .slice(0, 200)
                  .filter((chunk) => withinRecallScope(chunk, options!))
            : [];
        const sourceChunks = keywordChunks.filter((chunk) => chunk.id.startsWith("message:"));
        const allChunks = [
            ...new Map([...semanticChunks, ...keywordChunks.filter((chunk) => !chunk.id.startsWith("message:"))].map((chunk) => [chunk.id, chunk])).values(),
        ];
        const validChunks = vector ? allChunks.filter((chunk) => chunk.embedding?.length === vector.length) : [];
        if (vector && validChunks.length < allChunks.length) void this.rebuildIndex();
        const tokens = recallTokens(queryText);
        const relevance = (chunk: MemoryChunkData): number => {
            const semantic = vector && chunk.embedding?.length === vector.length ? cosineSimilarity(vector, chunk.embedding) : 0;
            const lexical = options.platform && options.channelId ? keywordRelevance(chunk.content, tokens) : 0;
            // A lexical score denotes lexical evidence, never a fabricated cosine similarity.
            return Math.max(Number.isFinite(semantic) && semantic >= minAllowedSim ? semantic : 0, lexical);
        };
        // 各会话分别建立时间线，宽范围检索也不能把不同会话作为邻居。
        allChunks.sort((a, b) => new Date(a.startTimestamp).getTime() - new Date(b.startTimestamp).getTime());

        const chunkIndexMap = new Map<string, number>();
        const chunkMap = new Map<string, MemoryChunkData>();
        const timelines = new Map<string, MemoryChunkData[]>();
        const timelineIds = new Set(semanticChunks.map((chunk) => chunk.id));
        allChunks.forEach((chunk) => {
            chunkMap.set(chunk.id, chunk);
            // Keyword pools omit non-matches, so adjacency can only come from the contiguous semantic window.
            if (!timelineIds.has(chunk.id)) return;
            const key = this.targetKey(chunk);
            const timeline = timelines.get(key) || [];
            timelines.set(key, timeline);
            chunkIndexMap.set(chunk.id, timeline.length);
            timeline.push(chunk);
        });

        const resultsWithSimilarity = allChunks.map((chunk) => ({ ...chunk, similarity: relevance(chunk) }));
        resultsWithSimilarity.sort((a, b) => b.similarity - a.similarity || new Date(b.endTimestamp).getTime() - new Date(a.endTimestamp).getTime());
        const candidateChunks = resultsWithSimilarity.filter((chunk) => chunk.similarity > 0).slice(0, k);
        const candidateIds = new Set(candidateChunks.map((chunk) => chunk.id));

        const finalChunkIds = new Set<string>();
        for (const chunk of candidateChunks) {
            finalChunkIds.add(chunk.id);
            const currentIndex = chunkIndexMap.get(chunk.id);

            if (currentIndex === undefined || this.config.l2_memory.includeNeighborChunks === false) continue;

            const timeline = timelines.get(this.targetKey(chunk))!;
            if (currentIndex > 0) finalChunkIds.add(timeline[currentIndex - 1].id);
            if (currentIndex < timeline.length - 1) finalChunkIds.add(timeline[currentIndex + 1].id);
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
            .filter(Boolean) as Array<MemoryChunkData & { similarity: number }>;

        finalChunks.sort((a, b) => new Date(a.startTimestamp).getTime() - new Date(b.startTimestamp).getTime());

        const merged = this.groupAndMergeChunks(finalChunks, chunkIndexMap, candidateIds);
        // Prefer an existing indexed conversation over a duplicate source line in that conversation.
        const sources = sourceChunks.filter(
            (source) =>
                !merged.some((chunk) => chunk.platform === source.platform && chunk.channelId === source.channelId && chunk.content.includes(source.content)),
        );
        const seen = new Set<string>();
        const method: MemorySearchResult["retrievalMethod"] = vector ? (options.platform && options.channelId ? "hybrid" : "semantic") : "keyword";
        return [
            ...merged.map((chunk) => ({ ...chunk, retrievalMethod: method })),
            ...sources.map((chunk) => ({ ...chunk, similarity: keywordRelevance(chunk.content, tokens), retrievalMethod: "keyword" as const })),
        ]
            .sort((a, b) => b.similarity - a.similarity || new Date(b.endTimestamp).getTime() - new Date(a.endTimestamp).getTime())
            .filter((chunk) => {
                const key = JSON.stringify([chunk.platform, chunk.channelId, chunk.content]);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .slice(0, k)
            .sort((a, b) => new Date(a.startTimestamp).getTime() - new Date(b.startTimestamp).getTime());
    }

    /**
     * 将一组按时间排序的记忆块进行分组和合并。
     * 只有在同一会话时间线上连续的块才会被分到同一组并合并。
     * @param chunks - 待处理的、已按时间排序的记忆块（候选块+邻居）
     * @param chunkIndexMap - 块ID到其在会话时间线上索引的映射
     * @returns 合并后的记忆块列表
     */
    private groupAndMergeChunks(
        chunks: Array<MemoryChunkData & { similarity: number }>,
        chunkIndexMap: Map<string, number>,
        candidateIds: Set<string>,
    ): Array<MemoryChunkData & { similarity: number }> {
        if (chunks.length === 0) return [];

        const groups: Array<Array<MemoryChunkData & { similarity: number }>> = [];
        const conversations = new Map<string, Array<MemoryChunkData & { similarity: number }>>();
        for (const chunk of chunks) {
            const key = this.targetKey(chunk);
            const conversation = conversations.get(key) || [];
            conversations.set(key, conversation);
            conversation.push(chunk);
        }

        for (const conversation of conversations.values()) {
            let currentGroup: Array<MemoryChunkData & { similarity: number }> = [];
            for (const chunk of conversation) {
                if (currentGroup.length === 0) {
                    currentGroup.push(chunk);
                } else {
                    const lastChunkInGroup = currentGroup[currentGroup.length - 1];
                    const lastChunkIndex = chunkIndexMap.get(lastChunkInGroup.id)!;
                    const currentChunkIndex = chunkIndexMap.get(chunk.id)!;

                    // 检查当前块是否是上一块在会话时间线上的直接后继
                    if (currentChunkIndex === lastChunkIndex + 1) {
                        currentGroup.push(chunk);
                    } else {
                        // 不连续，开启新分组
                        groups.push(currentGroup);
                        currentGroup = [chunk];
                    }
                }
            }
            if (currentGroup.length > 0) groups.push(currentGroup);
        }

        const mergedResults: Array<MemoryChunkData & { similarity: number }> = [];

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

            const mergedContentParts: string[] = [];
            mergedContentParts.push(candidateIds.has(firstChunk.id) ? firstChunk.content : splitContent(firstChunk.content, false));
            middleChunks.forEach((chunk) => mergedContentParts.push(chunk.content));
            mergedContentParts.push(candidateIds.has(lastChunk.id) ? lastChunk.content : splitContent(lastChunk.content, true));

            const mergedContent = mergedContentParts.join("\n");
            const maxSimilarity = Math.max(...group.map((chunk) => chunk.similarity));

            mergedResults.push({
                ...firstChunk,
                id: `merged-${firstChunk.id}-${lastChunk.id}`,
                endTimestamp: lastChunk.endTimestamp,
                content: mergedContent,
                similarity: maxSimilarity,
                embedding: firstChunk.embedding,
                participantIds: [...new Set(group.flatMap((chunk) => chunk.participantIds))],
            });
        }

        return mergedResults.sort((a, b) => new Date(a.startTimestamp).getTime() - new Date(b.startTimestamp).getTime());
    }

    public compileEventsToText(messages: Array<MessageData | ContextualMessage>): string {
        return messages.map((m) => `${m.sender.name || m.sender.id}: ${m.content}`).join("\n");
    }

    /**
     * 重建所有 L2 记忆片段的向量索引。
     * 增加状态锁，防止多个重建任务同时运行。
     */
    public async rebuildIndex() {
        if (this.stopped) return;
        if (this.isRebuilding) {
            this.logger.info("索引重建任务已在后台运行，本次请求被跳过");
            return;
        }
        if (!this.embedModel) {
            this.logger.warn("无可用嵌入模型，无法重建索引");
            return;
        }

        this.isRebuilding = true;
        const task = this.rebuildChunks();
        this.pendingBatches.add(task);
        try {
            await task;
        } finally {
            this.pendingBatches.delete(task);
        }
    }

    private async rebuildChunks(): Promise<void> {
        this.logger.info("开始重建 L2 记忆索引...");

        try {
            // 等待正在执行的删除，再保留读取前的版本快照，覆盖查询跨越清理的情况。
            while (this.activeClears.size) await Promise.all([...this.activeClears].map((entry) => entry.done));
            const generations = new Map(this.generations);
            const allChunks = await this.ctx.database.get(TableName.L2Chunks, {});
            let successCount = 0;
            let failCount = 0;

            for (const chunk of allChunks) {
                try {
                    const generation = this.generation(chunk, generations);
                    if (this.generation(chunk) !== generation) continue;
                    const result = await withUsageScope({ platform: chunk.platform, target: chunk.channelId, purpose: "L2索引重建" }, () =>
                        this.embedModel!.embed(chunk.content),
                    );
                    if (
                        await this.writeMemory(chunk, generation, () =>
                            this.ctx.database.set(TableName.L2Chunks, { id: chunk.id }, { embedding: result.embedding }),
                        )
                    ) {
                        successCount++;
                    }
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
