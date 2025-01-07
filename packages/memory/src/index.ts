import { Context, Schema, Service } from "koishi";
import { ChatMessage } from "koishi-plugin-yesimbot";
import { EmbeddingBase, calculateCosineSimilarity } from "koishi-plugin-yesimbot/embeddings";
import { getEmbedding } from "koishi-plugin-yesimbot/utils";
import { EmbeddingConfig } from "./config";
import { MemoryItem, MemoryType } from "./model";
import { MemoryMetadata, MemoryVectorStore } from "./vectorStore";
import { MEMORY_PROMPT } from "./prompt";

declare module "koishi" {
  interface Context {
    memory: Memory;
  }
}

export const inject = {
  required: ["yesimbot", "database"],
};

export { Config } from "./config";

class Memory extends Service {
  private vectorStore: MemoryVectorStore;
  private embedder: EmbeddingBase;

  public MEMORY_PROMPT = MEMORY_PROMPT;

  constructor(ctx: Context, config: Memory.Config) {
    super(ctx, "memory");
    this.vectorStore = new MemoryVectorStore(ctx);
    this.embedder = getEmbedding({Enabled: true, ...config.embedding});
  }

  // 获取单个记忆条目
  get(memoryId: string): MemoryItem {
    return this.vectorStore.get(memoryId);
  }

  // 获取所有记忆
  getAll(): MemoryItem[] {
    return this.vectorStore.getAll();
  }

  // 删除单个记忆
  delete(memoryId: string) {
    return this.vectorStore.delete(memoryId);
  }

  // 清空所有记忆
  clear() {
    this.vectorStore.clear();
  }

  async addCoreMemory(content: string) {
    const embedding = await this.embedder.embed(content);
    const metadata: MemoryMetadata = {
      content,
      topic: "核心记忆",
      keywords: [],
      type: MemoryType.Core,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return this.vectorStore.addVector(embedding, metadata);
  }

  async modifyCoreMemory(oldContent: string, newContent: string) {
    const memory = this.vectorStore.find(item => item.content === oldContent);
    if (memory) {
      const embedding = await this.embedder.embed(newContent);
      const metadata: MemoryMetadata = {
        content: newContent,
        topic: memory.topic,
        keywords: memory.keywords,
        type: memory.type,
        createdAt: memory.createdAt,
        updatedAt: new Date(),
      };
      this.vectorStore.update(memory.id, embedding, metadata);
    }
  }

  async addUserMemory(userId: string, content: string) {
    const embedding = await this.embedder.embed(content);
    const metadata: MemoryMetadata = {
      content,
      topic: "user",
      keywords: [`User:${userId}`],
      type: MemoryType.User,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.vectorStore.addVector(embedding, metadata)
  }

  async modifyUserMemory(userId: string, oldContent: string, newContent: string) {
    const memory = this.vectorStore.find(item => item.content === oldContent && item.keywords.includes(`User:${userId}`));

    if (memory) {
      const embedding = await this.embedder.embed(newContent);
      const metadata: MemoryMetadata = {
        content: newContent,
        topic: memory.topic,
        keywords: memory.keywords,
        type: memory.type,
        createdAt: memory.createdAt,
        updatedAt: new Date(),
      };
      this.vectorStore.update(memory.id, embedding, metadata);
    }

  }

  async addArchivalMemory(content: string, type: MemoryType, topic: string, keywords: string[]) {
    // TODO: 可选的 option 参数，不存在时使用LLM自动生成
    const embedding = await this.embedder.embed(content);
    this.vectorStore.addVector(embedding, {
      content,
      type,
      topic,
      keywords,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  async searchArchivalMemory(query: string, options: { type?: MemoryType, topic?: string, keywords?: string[]; limit?: number }): Promise<string[]> {
    const contextEmbedding = await this.embedder.embed(query);

    // 1. 主题与关键词过滤
    let filteredMemory = this.vectorStore.filter(item => {
      const topicMatch = options.topic ? item.topic === options.topic : true;
      const keywordMatch = options.keywords
        ? options.keywords.some(keyword => item.keywords.includes(keyword))
        : true;
      return topicMatch && keywordMatch;
    });

    // 2. 语义相似度计算
    const scoredMemory = filteredMemory.map(item => {
      const similarity = calculateCosineSimilarity(contextEmbedding, item.embedding);
      return { ...item, similarity };
    });

    // 3. 排序并限制结果数
    const sortedMemory = scoredMemory
      .sort((a, b) => b.similarity - a.similarity) // 按相似度降序排序
      .slice(0, options.limit || 5); // 限制返回结果数

    return sortedMemory.map(item => item.content);
  }


  /**
   * Searches for conversation messages from a specific user that are semantically similar to a given query.
   *
   * This method performs the following steps:
   * 1. Embeds the query into a vector representation using the configured embedder.
   * 2. Retrieves the most recent chat messages sent by the specified user from the database.
   * 3. Computes the cosine similarity between the query embedding and the embedding of each chat message.
   * 4. Sorts the messages by similarity in descending order and limits the results to the specified count.
   * 5. Re-sorts the limited results by the original send time in ascending order to maintain chronological order.
   * 6. Returns the content of the most relevant messages.
   *
   * @param query - The search query string to find similar messages.
   * @param userId - The ID of the user whose messages are to be searched.
   * @param count - The maximum number of messages to return. Defaults to 10.
   * @returns A promise that resolves to an array of message contents sorted by relevance and chronological order.
   */
  async searchConversation(query: string, userId: string, count: number = 10): Promise<string[]>{
    let embedding = await this.embedder.embed(query);

    let chatMessages = await this.ctx.database
      .select("yesimbot")
      .where({ senderId: userId })
      .orderBy("sendTime", "desc")
      .execute()

    let chatMessagesWithSimilarity: Array<{ chatMessage: ChatMessage, similarity: number }> = [];

    for (let chatMessage of chatMessages) {
      let chatEmbedding = await this.embedder.embed(chatMessage.content);
      let similarity = calculateCosineSimilarity(embedding, chatEmbedding);

      chatMessagesWithSimilarity.push({
        chatMessage,
        similarity,
      });
    }

    chatMessagesWithSimilarity
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, count)
      .sort((a, b) => a.chatMessage.sendTime.getTime() - b.chatMessage.sendTime.getTime());

    return chatMessagesWithSimilarity.map((chatMessage) => chatMessage.chatMessage.content);
  }
}

namespace Memory {
  export interface Config {
    embedding: EmbeddingConfig;
  }
  export const Config: Schema<Config> = Schema.object({
    embedding: EmbeddingConfig,
  });
}

export default Memory;

export * from "./model";
export * from "./prompt";
export * from "./vectorStore";

