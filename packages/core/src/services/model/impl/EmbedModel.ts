import type { EmbedProvider } from "@xsai-ext/shared-providers";
import type { EmbedManyOptions, EmbedOptions } from "xsai";

import { embed, embedMany } from "../../../dependencies/xsai";
import { ModelConfig } from "../types";

export class EmbedModel {
    constructor(private embedProvider: EmbedProvider, private modelConfig: ModelConfig, private fetch: typeof globalThis.fetch) {
        // The constructor is now cleaner. All necessary info is in modelConfig.
    }

    /**
     * Creates an embedding for a single piece of text.
     * @param text The text to embed.
     */
    public async embed(text: string): Promise<ReturnType<typeof embed>> {
        const embedOptions: EmbedOptions = {
            fetch: this.fetch,
            input: text,
            ...this.embedProvider.embed(this.modelConfig.ModelID),
        };
        return await embed(embedOptions);
    }

    /**
     * Creates embeddings for multiple pieces of text in a single batch.
     * @param texts The array of texts to embed.
     */
    public async embedMany(texts: string[]): Promise<ReturnType<typeof embedMany>> {
        const embedManyOptions: EmbedManyOptions = {
            fetch: this.fetch,
            input: texts,
            ...this.embedProvider.embed(this.modelConfig.ModelID),
        };
        return await embedMany(embedManyOptions);
    }
}

/**
 * Calculates the cosine similarity between two vectors.
 * The similarity is normalized to a [0, 1] range.
 *
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

    // Cosine similarity is in [-1, 1]. We normalize it to [0, 1] for easier use.
    const similarity = dotProduct / (magnitude1 * magnitude2);
    return (similarity + 1) / 2;
}
