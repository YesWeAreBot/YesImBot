import path from "path";
import { randomUUID } from "crypto";
import { Context } from "koishi";

import { CacheManager } from "koishi-plugin-yesimbot";
import { calculateCosineSimilarity } from "koishi-plugin-yesimbot/embeddings";
import { MemoryItem } from "./model";

export interface Metadata {
  content: string;
  topic: string;
  keywords: string[];
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
    return vectors;
  }

  delete(id: string) {
    return this.store.remove(id);
  }

  update(id: string, embedding: number[], metadata: Metadata) {
    if (!this.store.has(id)) {
      return;
    }

    let oldVector = this.store.get(id);

    oldVector.embedding = embedding;
    oldVector.magnitude = getMagnitude(embedding);
    oldVector.content = metadata.content;
    oldVector.topic = metadata.topic || oldVector.topic;
    oldVector.keywords = metadata.keywords || oldVector.keywords;
    this.store.set(id, oldVector);
  }

  clear() {
    this.store.clear();
    this.store.commit();
  }

  /**
   * 将向量库持久化
   * 保存本地或者提交到数据库
   */
  commit() {
    this.store.commit();
  }

  async addVector(embedding: number[], metadata: Metadata): Promise<string> {
    const id = randomUUID();
    this.store.set(id, {
      id,
      embedding,
      magnitude: getMagnitude(embedding),

      ...metadata,
    });
    return id;
  }

  async addVectors(embeddings: number[][], metadatas: Metadata[]): Promise<void> {
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

  filterVectors(filter: (metadata: Metadata) => boolean): MemoryItem[] {
    return this.store.values().filter(filter);
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
  async similaritySearchVectorWithScore(query: number[], k: number, filter?: (metadata: Metadata) => boolean): Promise<[MemoryItem, number][]> {
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

/**
 * 获取向量的模
 * @param vector
 * @returns
 */
export function getMagnitude(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
}
