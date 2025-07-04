import type { EmbedProvider } from "@xsai-ext/shared-providers";
import { Context, Logger } from "koishi";
import type { EmbedManyOptions, EmbedOptions } from "xsai";
import { embed, embedMany } from "../../dependencies/xsai";
import { ModelConfig } from "./config";

export class EmbedModel {
    private readonly logger: Logger;

    constructor(
        private ctx: Context,
        private readonly embedProvider: EmbedProvider,
        private readonly modelConfig: ModelConfig,
        private readonly fetch: typeof globalThis.fetch
    ) {
        this.logger = ctx.logger("model").extend(this.modelConfig.modelId);
    }

    public async embed(text: string): Promise<ReturnType<typeof embed>> {
        this.logger.debug(`Embedding single text: "${text.substring(0, 50)}..."`);
        const embedOptions: EmbedOptions = {
            fetch: this.fetch,
            input: text,
            ...this.embedProvider.embed(this.modelConfig.modelId),
        };
        return await embed(embedOptions);
    }

    public async embedMany(texts: string[]): Promise<ReturnType<typeof embedMany>> {
        this.logger.debug(`Embedding ${texts.length} texts.`);
        const embedManyOptions: EmbedManyOptions = {
            fetch: this.fetch,
            input: texts,
            ...this.embedProvider.embed(this.modelConfig.modelId),
        };
        return await embedMany(embedManyOptions);
    }
}

// 包含相似度计算函数
/**
 * Calculates the cosine similarity between two vectors.
 * The similarity is normalized to a [0, 1] range.
 * @param vec1 The first vector.
 * @param vec2 The second vector.
 * @returns A similarity score between 0 (not similar) and 1 (identical).
 */
export function calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length === 0 || vec2.length === 0 || vec1.length !== vec2.length) {
        return 0;
    }
    const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
    const magnitude1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
    const magnitude2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));

    if (magnitude1 === 0 || magnitude2 === 0) {
        return 0;
    }

    const similarity = dotProduct / (magnitude1 * magnitude2);
    return (similarity + 1) / 2; // Normalize from [-1, 1] to [0, 1]
}
