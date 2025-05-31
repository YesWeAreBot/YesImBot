import type { EmbedProvider } from "@xsai-ext/shared-providers";
import type { EmbedManyOptions, EmbedOptions } from "xsai";
import { embed, embedMany } from "../dependencies/xsai";

export class EmbedModel {
    constructor(private embedProvider: EmbedProvider, private model: string, private fetch: typeof globalThis.fetch) { }

    public async embed(text: string) {
        const embedOptions: EmbedOptions = {
            fetch: this.fetch,
            input: text,
            ...this.embedProvider.embed(this.model),
        };
        return await embed(embedOptions);
    }

    public async embedMany(texts: string[]) {
        const embedManyOptions: EmbedManyOptions = {
            fetch: this.fetch,
            input: texts,
            ...this.embedProvider.embed(this.model),
        };
        return await embedMany(embedManyOptions);
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