import type { EmbedProvider } from "@xsai-ext/shared-providers";
import type { EmbedManyOptions, EmbedManyResult, EmbedOptions, EmbedResult } from "@xsai/embed";
import type { WithUnknown } from "@xsai/shared";
import { Logger } from "koishi";
import { embed, embedMany } from "xsai";

import { BaseModel } from "./base-model";
import { ModelConfig } from "./config";

export interface IEmbedModel extends BaseModel {
    embed(text: string): Promise<EmbedResult>;
    embedMany(texts: string[]): Promise<EmbedManyResult>;
}

export class EmbedModel extends BaseModel implements IEmbedModel {
    constructor(
        logger: Logger,
        private readonly providerName: string,
        private readonly embedProvider: EmbedProvider["embed"],
        modelConfig: ModelConfig,
        private readonly fetch: typeof globalThis.fetch
    ) {
        super(logger, modelConfig);
    }

    public async embed(text: string): Promise<EmbedResult> {
        const embedOptions: WithUnknown<EmbedOptions> = {
            ...this.embedProvider(this.config.modelId),
            fetch: this.fetch,
            input: text,
        };
        return embed(embedOptions);
    }

    public async embedMany(texts: string[]): Promise<EmbedManyResult> {
        this.logger.debug(`Embedding ${texts.length} texts.`);
        const embedManyOptions: WithUnknown<EmbedManyOptions> = {
            ...this.embedProvider(this.config.modelId),
            fetch: this.fetch,
            input: texts,
        };
        return embedMany(embedManyOptions);
    }
}
