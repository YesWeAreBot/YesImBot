import path from "path";
import { randomUUID } from "crypto";
import { Context } from "koishi";
import { defineAccessor } from "@satorijs/core";

import { CacheManager } from "koishi-plugin-yesimbot";
import { calculateCosineSimilarity } from "koishi-plugin-yesimbot/embeddings";
import { MemoryItem } from "./model";

export interface MemoryMetadata {
  content: string;
  topic: string;
  keywords: string[];

  type: "核心记忆" | "用户记忆" | "群成员记忆" | "通用知识";
  createdAt: Date;
  updatedAt: Date;
}


export interface  MemoryVectorStore {
  get(id: string): MemoryItem;
  delete(id: string): boolean;
  clear(): void;
}

export class MemoryVectorStore {
  readonly store: CacheManager<MemoryItem>;

  constructor(private ctx: Context) {
    const vectorsFilePath = path.join(ctx.baseDir, "data/yesimbot/.vector_cache/memory.bin");
    this.store = new CacheManager(vectorsFilePath, true);
  }

  get(id: string): MemoryItem | undefined {
    return this.store.get(id);
  }

  getAll(): MemoryItem[] {
    let vectors = this.store.values();
    return Array.from(vectors);
  }

  find(filter: (metadata: MemoryMetadata) => boolean): MemoryItem {
    return this.getAll().find(filter);
  }

  update(id: string, embedding: number[], metadata: MemoryMetadata): void {
    if (!this.store.has(id)) return;

    const oldVector = this.store.get(id);
    if (!oldVector) return;

    const updatedVector: MemoryItem = {
      ...oldVector,
      embedding,
      magnitude: getMagnitude(embedding),
      content: metadata.content,
      topic: metadata.topic || oldVector.topic,
      keywords: metadata.keywords || oldVector.keywords,
      type: metadata.type || oldVector.type,
      updatedAt: new Date(),
    };

    this.store.set(id, updatedVector);
  }

  /**
   *
   * @param embedding
   * @param metadata
   * @returns memoryId
   */
  async addVector(embedding: number[], metadata: MemoryMetadata): Promise<string> {
    const id = randomUUID();
    this.store.set(id, {
      id,
      embedding,
      magnitude: getMagnitude(embedding),

      ...metadata,
    });
    return id;
  }

  async addVectors(embeddings: number[][], metadatas: MemoryMetadata[]): Promise<void> {
    embeddings.forEach((embedding, index) => {
      const id = randomUUID();
      this.store.set(id, {
        id,
        embedding,
        magnitude: getMagnitude(embedding),

        ...metadatas[index],
      })
    });
  }

  filter(filter: (metadata: MemoryMetadata) => boolean): MemoryItem[] {
    return this.getAll().filter(filter);
  }

  /**
   * Find k most similar vectors to the given query vector.
   *
   * This function returns the k most similar vectors to the given query vector,
   * along with their similarity scores. The similarity is calculated using the
   * cosine similarity metric.
   *
   * @param query The query vector to search for.
   * @param k The number of most similar vectors to return.
   * @param filter A filter function to apply to the vectors before returning them.
   * @returns An array of [Vector, number] pairs, where the first element is the
   *          vector and the second element is the similarity score. The array is
   *          sorted in descending order of similarity score.
   */
  async similaritySearchVectorWithScore(query: number[], k: number, filter?: (metadata: MemoryMetadata) => boolean): Promise<[MemoryItem, number][]> {
    const magnitude = getMagnitude(query);
    let results: [MemoryItem, number][] = [];

    for (const vector of this.store.values()) {
      if (!vector.magnitude) vector.magnitude = getMagnitude(vector.embedding);
      const similarity = calculateCosineSimilarity(query, vector.embedding, magnitude, vector.magnitude);
      if (!filter || filter(vector)) {
        results.push([vector, similarity]);
      }
    }

    results.sort((a, b) => b[1] - a[1]);
    return results.slice(0, k);
  }

  async similaritySearch(query: number[], k: number, filter?: (vector: MemoryItem) => boolean): Promise<MemoryItem[]> {
    const results = await this.similaritySearchVectorWithScore(query, k, filter);
    return results.map((result) => result[0]);
  }
}

defineAccessor(MemoryVectorStore.prototype, "get", ["store", "get"]);
defineAccessor(MemoryVectorStore.prototype, "clear", ["store", "clear"]);
defineAccessor(MemoryVectorStore.prototype, "delete", ["store", "delete"]);

/**
 * 获取向量的模
 * @param vector
 * @returns
 */
export function getMagnitude(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
}
