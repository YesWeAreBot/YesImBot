import { Context, Schema, Service } from "koishi";
import { EmbeddingBase } from "koishi-plugin-yesimbot/embeddings";
import { getEmbedding } from "koishi-plugin-yesimbot/utils";
import { EmbeddingConfig } from "./config";
import { initDatabase } from "./database";
import { GroupActivity, GuildMemory, MemoryItem, UserMemory } from "./model";
import { MemoryVectorStore, Metadata } from "./vectorStore";

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
    initDatabase(ctx);
    this.vectorStore = new MemoryVectorStore(ctx);
    this.embedder = getEmbedding(config.embedding);
  }

  // 获取单个记忆条目
  get(memoryId: string): Metadata {
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

  async update(memoryId: string, content: string, topic?: string, keywords?: string[]): Promise<void> {
    const embedding = await this.embedder.embed(content);

    if (!topic || !keywords) {
      // TODO: 通过文本内容推断 topic 和 keywords（调用 LLM 或语义匹配）
    }

    this.vectorStore.update(memoryId, embedding, {
      content: content,
      topic: topic,
      keywords: keywords,
    });
  }

  // 添加一条新的记忆
  async addMemory(content: string, topic: string, keywords: string[]): Promise<string> {
    const embedding = await this.embedder.embed(content);

    const memoryId = await this.vectorStore.addVector(embedding, {
      content: content,
      topic: topic,
      keywords: keywords,
    });

    return memoryId;
  }

  async addUserMemory(userId: string, guildId: string, content: string, role: string): Promise<void> {
    const embedding = await this.embedder.embed(content);

    const { topic, keywords } = await this.extractTopicAndKeywords(content);

    await this.vectorStore.addVector(embedding, {
      content,
      topic,
      keywords: [...keywords, `user:${userId}`, `guild:${guildId}`], // 将用户和群聊的ID作为关键词
    });

    await this.updateUserMemory(userId, guildId, content, role);
    await this.updateGuildMemory(guildId, content, role);
  }

  private async updateUserMemory(userId: string, guildId: string, content: string, role: string): Promise<void> {
    let result = this.getUserMemory(userId);


  }

  private async updateGuildMemory(guildId: string, content: string, role: string): Promise<void> {

  }

  private async getUserMemory(userId: string): Promise<UserMemory | undefined> {
    let result = await this.ctx.model.get("yesimbot.memory.user", { userId });

    if (result.length > 0) {
      return result[0];
    }
  }

  // 获取群聊记忆（示例）
  private async getGuildMemory(guildId: string): Promise<GuildMemory | undefined> {
    let result = await this.ctx.model.get("yesimbot.memory.guild", { guildId });

    if (result.length > 0) {
      return result[0];
    }
  }

  // 提取 Topic 和 Keywords
  private async extractTopicAndKeywords(text: string): Promise<{ topic: string; keywords: string[] }> {
    const topic = "群聊讨论"; // 模拟提取话题
    const keywords = ["讨论", "游戏", "技术"]; // 模拟提取关键词
    return { topic, keywords };
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
