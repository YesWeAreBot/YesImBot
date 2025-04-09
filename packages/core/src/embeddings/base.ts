import { embed, embedMany, EmbedManyResult, EmbedResult } from '@xsai/embed';

import { CacheManager } from "../managers/cacheManager";
import { EnabledEmbeddingConfig } from "./config";

export class EmbeddingBase {
    protected readonly cache: CacheManager<number[]> | undefined;
    protected readonly apiKey: string | undefined;
    protected readonly baseURL: string | undefined;
    protected readonly model: string | undefined;

    constructor(protected config: EnabledEmbeddingConfig, manager?: CacheManager<number[]>) {
        this.cache = manager;

        this.apiKey = config.APIKey;
        this.baseURL = config.BaseURL;
        this.model = config.Model;
    }

    async _embed(text: string): Promise<EmbedResult> {
        return await embed({
            input: text,
            model: this.model,
            apiKey: this.apiKey,
            baseURL: this.baseURL
        });
    }

    async _embedMany(texts: string[]): Promise<EmbedManyResult> {
        return await embedMany({
            input: texts,
            model: this.model,
            apiKey: this.apiKey,
            baseURL: this.baseURL
        });
    }

    /**
     * 带有缓存功能的文本向量化
     * @param text
     * @param toFixed 要保留的小数位
     * @returns
     */
    async embed(text: string, toFixed?: number): Promise<number[]> {
        if (this.cache && this.cache.has(text)) {
            return this.cache.get(text);
        } else {
            try {
                let { embedding } = await this._embed(text);
                if (toFixed) embedding = embedding.map(x => Number(x.toFixed(toFixed)));
                this.cache?.set(text, embedding);
                return embedding;
            } catch (error) {
                throw new Error(`获取文本向量失败`);
            }
        }
    }
}

/**
 * 计算向量的余弦相似度
 * @param vec1 第一个向量
 * @param vec2 第二个向量
 * @param m1 第一个向量的模，没有则重新计算
 * @param m2 第二个向量的模，没有则重新计算
 **/
export function calculateCosineSimilarity(vec1: number[], vec2: number[], m1?: number, m2?: number): number {
    if (vec1.length === 0 || vec2.length === 0 || vec1.length !== vec2.length) {
        return 0;
    }
    const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
    const magnitude1 = m1 || Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
    const magnitude2 = m2 || Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
    return magnitude1 && magnitude2 ? (dotProduct / (magnitude1 * magnitude2) + 1) / 2 : 0; // Transform from [-1, 1] to [0, 1]
}
