import path from "path";
import { randomUUID } from "crypto";
import { Context } from "koishi";

import { calculateCosineSimilarity } from "../embeddings/base";
import { CacheManager } from "../managers/cacheManager";


export interface Vector {
  id: string;        // 随机生成的id
  vector: number[];  // 向量
  magnitude: number; // 向量的模

  content: string;    // 记忆内容
  createdAt: number;  // 创建时间
  updatedAt?: number; // 更新时间，用于计算时间权重

  userId?: string;    // 记忆关联的用户ID
}

export interface Metadata {
  content: string;    // 记忆内容
  createdAt: number;  // 创建时间
  updatedAt?: number; // 更新时间，用于计算时间权重

  userId?: string;    // 记忆关联的用户ID
}

export class MemoryVectorStore {
  private vectorStore: CacheManager<Vector>;

  constructor(private ctx: Context) {
    const vectorsFilePath = path.join(__dirname, "../../data/.vector_cache/memory.bin");
    this.vectorStore = new CacheManager(vectorsFilePath, true);
  }

  async addVector(vector: number[], metadata: Metadata): Promise<string> {
    const id = randomUUID();
    this.vectorStore.set(id, {
      id,
      vector,
      magnitude: getMagnitude(vector),

      ...metadata,
    });
    return id;
  }

  async addVectors(vectors: number[][], metadatas: Metadata[]): Promise<void> {
    vectors.forEach((vector, index) => {
      const id = randomUUID();
      this.vectorStore.set(id, {
        id,
        vector,
        magnitude: getMagnitude(vector),

        ...metadatas[index],
      })
    });
  }

  removeVector(id: string) {
    this.vectorStore.remove(id);
  }

  getVector(id: string): Vector | undefined {
    return this.vectorStore.get(id);
  }

  updateVector(id: string, vector: number[], metadata: Metadata) {
    this.vectorStore.set(id, {
      id,
      vector,
      magnitude: getMagnitude(vector),

      ...metadata,
    })
  }

  /**
   * 将向量库持久化
   * 保存本地或者提交到数据库
   */
  commit() {
    this.vectorStore.commit();
  }

  filterVectors(filter: (metadata: Metadata) => boolean): Vector[] {
    return this.vectorStore.values().filter(filter);
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
  async similaritySearchVectorWithScore(query: number[], k: number, filter?: (metadata: Metadata) => boolean): Promise<[Vector, number][]> {
    const magnitude = getMagnitude(query);
    let results: [Vector, number][] = [];

    for (const vector of this.vectorStore.values()) {
      const similarity = calculateCosineSimilarity(query, vector.vector, magnitude, vector.magnitude);
      if (!filter || filter(vector)) {
        results.push([vector, similarity]);
      }
    }

    results.sort((a, b) => b[1] - a[1]);
    return results.slice(0, k);
  }

  async similaritySearch(query: number[], k: number, filter?: (vector: Vector) => boolean): Promise<Vector[]> {
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
