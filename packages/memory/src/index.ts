import { Context, Schema, Service } from "koishi";
import { ChatMessage, EmbeddingBase, calculateCosineSimilarity, getEmbedding } from "koishi-plugin-yesimbot";
import { EmbeddingConfig } from "./config";
import { MemoryItem, MemoryType } from "./model";
import { MEMORY_PROMPT } from "./prompt";
import { MemoryMetadata, MemoryVectorStore } from "./vectorStore";

declare module "koishi" {
  interface Context {
    memory: Memory;
  }
}

export const inject = {
  required: ["yesimbot", "database"],
};

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

  async modifyMemoryById(memoryId: string, content: string, type?: MemoryType, topic?: string, keywords?: string[]) {
    const memory = this.vectorStore.get(memoryId);
    if (memory) {
      const embedding = (content == memory.content) ? memory.embedding : await this.embedder.embed(content);
      const metadata: MemoryMetadata = {
        content,
        type: type || memory.type,
        topic: topic || memory.topic,
        keywords: keywords || memory.keywords,
        createdAt: memory.createdAt,
        updatedAt: new Date(),
      };
      this.vectorStore.update(memoryId, embedding, metadata);
    }
  }

  async addCoreMemory(content: string, topic?: string, keywords?: string[]) {
    const embedding = await this.embedder.embed(content);
    const metadata: MemoryMetadata = {
      content,
      type: MemoryType.Core,
      topic,
      keywords,
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

  async searchArchivalMemory(query: string, type?: MemoryType, topic?: string, keywords?: string[], limit?: number): Promise<string[]> {
    const contextEmbedding = await this.embedder.embed(query);

    // 1. 主题与关键词过滤
    let filteredMemory = this.vectorStore.filter(item => {
      const topicMatch = topic ? item.topic === topic : true;
      const keywordMatch = keywords
        ? keywords.some(keyword => item.keywords.includes(keyword))
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
      .slice(0, limit || 5); // 限制返回结果数

    return sortedMemory.map(item => item.content);
  }

  /**
   * 搜索与给定查询语义相似且来自特定用户的对话消息。
   *
   * 该方法执行以下步骤：
   * 1. 使用配置的嵌入器将查询嵌入为向量表示。
   * 2. 从数据库中检索指定用户发送的最新聊天消息。
   * 3. 计算查询嵌入与每条聊天消息嵌入之间的余弦相似度。
   * 4. 按相似度降序排序消息，并将结果限制为指定的数量。
   * 5. 将限制后的结果按原始发送时间升序重新排序，以保持时间顺序。
   * 6. 返回最相关消息的内容。
   *
   * @param query - 用于查找相似消息的搜索查询字符串。
   * @param userId - 要搜索消息的用户ID。
   * @param count - 要返回的最大消息数量。默认为10。
   * @returns 一个Promise，解析为按相关性和时间顺序排序的消息内容数组。
   */
  async searchConversation(query: string, userId: string, count: number = 10): Promise<string[]> {
    let embedding = await this.embedder.embed(query);

    let chatMessages = await this.ctx.database
      .select("yesimbot.message")
      .where({ "sender.id": userId })
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
    memorySize: number;              // 记忆容量
    summarySize: number;             // 上下文达到多少时进行总结
    retainedContextSize: number;     // 进行总结时保留的上下文长度，用于保持记忆连贯性
    maxCoreMemoryCharacters: number; // 最大记忆字符数
    embedding: EmbeddingConfig;
  }
  export const Config: Schema<Config> = Schema.object({
    memorySize: Schema.number().default(1000),
    summarySize: Schema.number().default(100),
    retainedContextSize: Schema.number().default(10),
    maxCoreMemoryCharacters: Schema.number().default(5000),
    embedding: EmbeddingConfig,
  });
}

export default Memory;

export * from "./model";
export * from "./prompt";
export * from "./vectorStore";

