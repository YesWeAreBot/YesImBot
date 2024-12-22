import { Context } from "koishi";

import { BaseAdapter } from "../adapters/base";
import { Config } from "../config";
import { EmbeddingsBase } from "../embeddings/base";
import { getAdapter, getEmbedding } from "../utils/factory";
import { MemoryVectorStore, Metadata, Vector } from "./vectorStore";
import { LLMConfig } from "../adapters";
import { EmbeddingsConfig } from "../embeddings";

export class Memory {
  private vectorStore: MemoryVectorStore;

  private llm: BaseAdapter;
  private embedder: EmbeddingsBase;

  constructor(
    ctx: Context,
    adapterConfig: LLMConfig,
    embedderConfig: EmbeddingsConfig,
    parameters?: Config["Parameters"]
  ) {
    this.vectorStore = new MemoryVectorStore(ctx);
    this.llm = getAdapter(adapterConfig, parameters);
    this.embedder = getEmbedding(embedderConfig);
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

  async getMemoryById(id: string): Promise<Vector> {
    let vector = this.vectorStore.getVector(id);
    return vector;
  }
}
