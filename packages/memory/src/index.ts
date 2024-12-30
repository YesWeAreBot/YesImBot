import { Context, Schema, Service } from "koishi";
import { EmbeddingBase } from "koishi-plugin-yesimbot/embeddings";
import { getEmbedding } from "koishi-plugin-yesimbot/utils";
import { MemoryVectorStore, Metadata, Vector } from "./vectorStore";
import { EmbeddingConfig } from "./config";

declare module "koishi" {
  interface Context {
    memory: Memory;
  }
}

export { Config } from "./config";

class Memory extends Service {
  private vectorStore: MemoryVectorStore;

  private embedder: EmbeddingBase;

  constructor(ctx: Context, config: Memory.Config) {
    super(ctx, "memory");
    this.vectorStore = new MemoryVectorStore(ctx);
    this.embedder = getEmbedding(config.embedding);
  }

  get(memoryId: string): Metadata {
    return this.vectorStore.get(memoryId);
  }

  getAll(): Vector[] {
    return this.vectorStore.getAll();
  }

  delete(memoryId: string) {
    return this.vectorStore.delete(memoryId);
  }

  async update(memoryId: string, data: any): Promise<void> {
    const embedding = await this.embedder.embed(data);
    return this.vectorStore.update(memoryId, embedding, data);
  }

  clear() {
    this.vectorStore.clear();
  }

  async addText(content: string, userId?: string): Promise<string> {
    let embedding = await this.embedder.embed(content);

    return await this.vectorStore.addVector(embedding, {
      content,
      createdAt: Date.now(),
      userId,
    });
  }

  async search(query: string, limit: number, userId?: string): Promise<string[]>
  async search(query: string, limit: number, filter?: (metadata: Metadata) => boolean): Promise<string[]>

  async search(
    query: string,
    limit: number = 5,
    filter?: string | ((metadata: Metadata) => boolean)
  ): Promise<string[]> {
    const embedding = await this.embedder.embed(query);

    const result = await this.vectorStore.similaritySearch(
      embedding,
      limit,
      filter ? typeof filter === "string" ? (metadata: Metadata) => metadata.userId === filter : filter : undefined
    );
    return result.map((item) => item.content);
  }

  getUserMemory(userId: string): string[] {
    let vectors = this.vectorStore.filterVectors(
      (vector) => vector.userId === userId
    );
    return vectors.map((vector) => vector.content);
  }

  filterMemory(filter: (metadata: Metadata) => boolean): string[] {
    let vectors = this.vectorStore.filterVectors(filter);
    return vectors.map((vector) => vector.content);
  }
}

namespace Memory {
  export interface Config {
    embedding: EmbeddingConfig
  }
  export const Config: Schema<Config> = Schema.object({
    embedding: EmbeddingConfig,
  });
}

export default Memory;

export * from "./vectorStore";
