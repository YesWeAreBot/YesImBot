import { IEmbedModel, TaskType } from "@/services/model";
import { Services, TableName } from "@/shared/constants";
import { cosineSimilarity } from "@/shared/utils";
import { Context, Logger } from "koishi";
import { HistoryConfig } from "./config";
import { AgentTurnData, MemoryChunkData, MessageData } from "./types";

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
    public async processConversationSlice(messages: MessageData[], agentTurn: AgentTurnData): Promise<void> {
        if (!this.embedModel || messages.length === 0) return;

        const { platform, channelId } = agentTurn;
        const participantIds = [...new Set(messages.map((m) => m.sender.id))];
        const conversationText = this.compileMessagesToText(messages, agentTurn);

        try {
            const embedding = await this.embedModel.embed(conversationText);
            const memoryChunk: MemoryChunkData = {
                id: `mem_${agentTurn.id}`,
                platform,
                channelId,
                content: conversationText,
                embedding: embedding.embedding,
                participantIds,
                startTimestamp: messages[0].timestamp,
                endTimestamp: agentTurn.timestamp,
            };
            await this.ctx.database.create(TableName.L2Chunks, memoryChunk);
            this.logger.debug(`对话切片已处理并存入 L2 记忆 | AgentTurn ID: ${agentTurn.id}`);
        } catch (error) {
            this.logger.error(`创建记忆片段失败 | AgentTurn ID: ${agentTurn.id}`, error);
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
