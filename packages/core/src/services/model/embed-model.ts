import type { EmbedProvider } from "@xsai-ext/shared-providers";
import type { EmbedManyOptions, EmbedManyResult, EmbedOptions, EmbedResult } from "@xsai/embed";
import { Context } from "koishi";

import { embed, embedMany } from "@/dependencies/xsai";
import { truncate } from "@/shared/utils";
import { BaseModel } from "./base-model";
import { ModelConfig } from "./config";

export interface IEmbedModel extends BaseModel {
    embed(text: string): Promise<EmbedResult>;
    embedMany(texts: string[]): Promise<EmbedManyResult>;
}

export class EmbedModel extends BaseModel implements IEmbedModel {
    constructor(
        ctx: Context,
        private readonly embedProvider: EmbedProvider["embed"],
        modelConfig: ModelConfig,
        private readonly fetch: typeof globalThis.fetch
    ) {
        super(ctx, modelConfig, `[嵌入模型] [${modelConfig.modelId}]`);
    }

    public async embed(text: string): Promise<EmbedResult> {
        //this.logger.debug(`正在为文本生成嵌入向量："${truncate(text, 50)}"`);
        const embedOptions: EmbedOptions = {
            ...this.embedProvider(this.config.modelId),
            fetch: this.fetch,
            input: text,
        };
        return embed(embedOptions);
    }

    public async embedMany(texts: string[]): Promise<EmbedManyResult> {
        this.logger.debug(`Embedding ${texts.length} texts.`);
        const embedManyOptions: EmbedManyOptions = {
            ...this.embedProvider(this.config.modelId),
            fetch: this.fetch,
            input: texts,
        };
        return embedMany(embedManyOptions);
    }
}

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
