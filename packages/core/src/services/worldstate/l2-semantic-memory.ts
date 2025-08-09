import { IEmbedModel, TaskType } from "@/services/model";
import { Services, TableName } from "@/shared/constants";
import { cosineSimilarity } from "@/shared/utils";
import { Context, Logger } from "koishi";
import { HistoryConfig } from "./config";
import { AgentTurnData, InteractionData, MemoryChunkData, MessageData } from "./types";

export class SemanticMemoryManager {
    private ctx: Context;
    private config: HistoryConfig;

    private logger: Logger;
    private embedModel: IEmbedModel;

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

    public stop() {}

    /**
     * 将一个已处理的交互轮次转化为 L2 记忆片段并存储。
     * @param interaction - The interaction data from L1.
     */
    public async processAndStoreTurn(interaction: InteractionData): Promise<void> {
        if (!this.embedModel) return;

        const messages = await this.ctx.database.get(TableName.Messages, { interactionId: interaction.id });
        const agentTurn = await this.ctx.database.get(TableName.AgentTurns, { interactionId: interaction.id }).then((res) => res[0]);

        if (messages.length === 0) return;

        const messageChunks = splitMessagesIntoChunks(
            messages,
            this.config.l2_memory.messagesPerChunk,
            this.config.l2_memory.messageOverlap
        );

        const participantIds = [...new Set(messages.map((m) => m.sender.id))];

        for (const chunk of messageChunks) {
            const chunkText = this.compileMessagesToText(chunk, agentTurn);
            try {
                const embedding = await this.embedModel.embed(chunkText);
                const memoryChunk: MemoryChunkData = {
                    id: `mem_${interaction.id}_${Math.random().toString(36).substring(2, 9)}`,
                    sourceInteractionId: interaction.id,
                    platform: interaction.platform,
                    channelId: interaction.channelId,
                    content: chunkText,
                    embedding: embedding.embedding,
                    participantIds,
                    startTimestamp: chunk[0].timestamp,
                    endTimestamp: chunk[chunk.length - 1].timestamp,
                };
                await this.ctx.database.create(TableName.L2Chunks, memoryChunk);
            } catch (error) {
                this.logger.error(`创建记忆片段失败 | 轮次ID: ${interaction.id}`, error);
            }
        }
        this.logger.debug(`交互轮次 ${interaction.id} 已处理并存入 L2 记忆`);
    }

    /**
     * 根据查询文本检索相关的记忆片段。
     * @param queryText - The text to search for.
     * @param k - The number of chunks to retrieve.
     * @returns A list of relevant memory chunks.
     */
    public async search(queryText: string, k: number): Promise<MemoryChunkData[]> {
        if (!this.embedModel) return [];

        const queryEmbedding = await this.embedModel.embed(queryText);

        const results = await this.ctx.database.get(TableName.L2Chunks, {});

        const resultsWithSimilarity = results.map((chunk) => ({
            ...chunk,
            similarity: cosineSimilarity(queryEmbedding.embedding, chunk.embedding),
        }));

        resultsWithSimilarity.sort((a, b) => b.similarity - a.similarity);

        return resultsWithSimilarity.slice(0, k);
    }

    private compileMessagesToText(messages: MessageData[], agentTurn?: AgentTurnData): string {
        let text = messages.map((m) => `${m.sender.name || m.sender.id}: ${m.content}`).join("\n");
        // Optionally, append the agent's turn summary to the last chunk of an interaction
        if (agentTurn) {
            text += `\n[AGENT]\nThoughts: ${agentTurn.thoughts.plan}`;
        }
        return text;
    }
}

/**
 * Filters out short, less meaningful messages.
 * @param messages The messages to filter.
 * @param minLength The minimum content length to keep.
 * @returns Filtered messages.
 */
function filterMeaningfulMessages(messages: MessageData[], minLength: number = 5): MessageData[] {
    return messages.filter((m) => m.content && m.content.trim().length > minLength);
}

/**
 * Splits an array of messages into overlapping chunks.
 * @param messages The array of messages to split.
 * @param messagesPerChunk The number of messages in each chunk.
 * @param messageOverlap The number of messages to overlap between chunks.
 * @returns An array of message chunks, where each chunk is an array of MessageData.
 */
export function splitMessagesIntoChunks(messages: MessageData[], messagesPerChunk: number, messageOverlap: number): MessageData[][] {
    if (messageOverlap >= messagesPerChunk) {
        throw new Error("messageOverlap must be smaller than messagesPerChunk.");
    }

    const meaningfulMessages = filterMeaningfulMessages(messages);
    const chunks: MessageData[][] = [];
    let i = 0;
    while (i < meaningfulMessages.length) {
        const end = Math.min(i + messagesPerChunk, meaningfulMessages.length);
        chunks.push(meaningfulMessages.slice(i, end));
        i += messagesPerChunk - messageOverlap;
    }
    return chunks;
}
