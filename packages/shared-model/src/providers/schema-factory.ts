import { Schema } from "koishi";

import { Modality } from "../types/model";
import type { ModelInfo } from "../types/model";

/** Minimal model entry for schema defaults — Schema fills in optional fields at runtime */
export type DefaultModelEntry = Pick<ModelInfo, "id"> &
  Partial<Pick<ModelInfo, "tool_call" | "reasoning" | "modalities">>;

export interface ProviderSchemaOptions<TExtra = Record<string, never>> {
  defaultId: string;
  defaultBaseURL: string;
  defaultModels: DefaultModelEntry[];
  extra?: Schema<TExtra>;
}

export function createProviderSchema<TExtra = Record<string, never>>(
  opts: ProviderSchemaOptions<TExtra>,
) {
  const base = Schema.object({
    id: Schema.string().default(opts.defaultId),
    apiKey: Schema.string().role("secret").required(),
    baseURL: Schema.string().default(opts.defaultBaseURL),
    models: Schema.array(
      Schema.object({
        id: Schema.string().required(),
        tool_call: Schema.boolean().default(true),
        reasoning: Schema.boolean().default(false),
        modalities: Schema.array(
          Schema.union([
            Schema.const(Modality.Text),
            Schema.const(Modality.Image),
            Schema.const(Modality.Pdf),
            Schema.const(Modality.Video),
            Schema.const(Modality.Audio),
          ]),
        )
          .default([Modality.Text])
          .role("checkbox"),
      }),
    )
      .default(opts.defaultModels as never)
      .role("table"),
    defaultParams: Schema.object({
      temperature: Schema.number().default(0.7),
      maxOutputTokens: Schema.number().default(2048),
      topP: Schema.number().default(1.0),
    }),
    advancedOverride: Schema.string()
      .role("textarea", { rows: [2, 4] })
      .default(""),
  });

  if (opts.extra) {
    return Schema.intersect([base, opts.extra]);
  }
  return base;
}
