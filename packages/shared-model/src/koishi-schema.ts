import type { SharedConfig } from "./index";
import { Schema } from "koishi";

export function createSharedConfigSchema<TModelConfig>(
    modelConfigSchema: Schema<TModelConfig>,
    options?: {
        retryDefault?: number;
        retryDelayDefault?: number;
        overrideValueSchema?: Schema<Partial<TModelConfig>>;
    },
): Schema<SharedConfig<TModelConfig>> {
    const retryDefault = options?.retryDefault ?? 3;
    const retryDelayDefault = options?.retryDelayDefault ?? 1000;

    const overrideValueSchema = options?.overrideValueSchema
        ?? (Schema.any() as unknown as Schema<Partial<TModelConfig>>);

    return Schema.object({
        retry: Schema.number().min(0).default(retryDefault),
        retryDelay: Schema.number().min(0).default(retryDelayDefault),
        modelConfig: modelConfigSchema,
        override: Schema.dict(overrideValueSchema).role("table").default({}),
    });
}
