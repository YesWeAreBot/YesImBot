import { Context, Schema, Service } from "koishi";
import { EmbeddingBase, calculateCosineSimilarity } from "koishi-plugin-yesimbot/embeddings";
import { getEmbedding } from "koishi-plugin-yesimbot/utils";
import { EmbeddingConfig } from "./config";
import { MemoryItem } from "./model";
import { MemoryMetadata, MemoryVectorStore } from "./vectorStore";

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

  async searchMemory(
    context: string,
    options: { type?: "核心记忆" | "用户记忆" | "群成员记忆" | "通用知识", topic?: string; keywords?: string[]; limit?: number }
  ): Promise<MemoryItem[]> {
    const contextEmbedding = await this.embedder.embed(context);

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

    return sortedMemory;
  }

  async addCoreMemory(content: string) {
    const embedding = await this.embedder.embed(content);
    const metadata: MemoryMetadata = {
      content,
      topic: "核心记忆",
      keywords: [],
      type: "核心记忆",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return this.vectorStore.addVector(embedding, metadata);
  }

  async updateCoreMemoryByContent(oldContent: string, newContent: string) {
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

  async updateCoreMemoryById(memoryId: string, newContent: string) {
    const memory = this.vectorStore.get(memoryId);
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

  async addUserMemory(content: string, userId: string) {
    const embedding = await this.embedder.embed(content);
    const metadata: MemoryMetadata = {
      content,
      topic: "user",
      keywords: [`User:${userId}`],
      type: "用户记忆",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.vectorStore.addVector(embedding, metadata)
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

export * from "./vectorStore";
