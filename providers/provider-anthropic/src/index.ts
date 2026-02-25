import { createAnthropic } from "@ai-sdk/anthropic";
import {
  IModelProvider,
  ModelInfo,
  Modality,
  IModelService,
  ModelDefaultParams,
} from "@yesimbot/shared-model";
import { Context, Schema } from "koishi";

declare module "koishi" {
  interface Context {
    "yesimbot.model": IModelService;
  }
}

export const name = "yesimbot-provider-anthropic";
export const reusable = true;
export const inject = ["yesimbot.model"];

export interface Config {
  id: string;
  apiKey: string;
  baseURL: string;
  models: Array<ModelInfo>;
  defaultParams: {
    temperature: number;
    maxTokens: number;
    topP: number;
  };
}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("anthropic"),
  apiKey: Schema.string().role("secret").required(),
  baseURL: Schema.string().default("https://api.anthropic.com"),
  models: Schema.array(
    Schema.object({
      id: Schema.string().required(),
      tool_call: Schema.boolean().default(true),
      reasoning: Schema.boolean().default(false),
      modalities: Schema.array(
        Schema.union([
          Schema.const(Modality.Audio),
          Schema.const(Modality.Image),
          Schema.const(Modality.Pdf),
          Schema.const(Modality.Text),
          Schema.const(Modality.Video),
        ]),
      )
        .default([Modality.Text])
        .role("checkbox"),
    }),
  )
    .default([
      {
        id: "claude-sonnet-4-20250514",
        tool_call: true,
        reasoning: false,
        modalities: [Modality.Text, Modality.Image],
      },
    ])
    .role("table"),
  defaultParams: Schema.object({
    temperature: Schema.number().default(0.7),
    maxTokens: Schema.number().default(2048),
    topP: Schema.number().default(1.0),
  }),
});

class AnthropicProvider implements IModelProvider {
  readonly id: string;
  readonly providerType = "anthropic";
  readonly models: ModelInfo[];
  readonly defaultParams: ModelDefaultParams;
  private client: ReturnType<typeof createAnthropic>;

  constructor(config: Config) {
    this.id = config.id;
    this.defaultParams = config.defaultParams;
    this.client = createAnthropic({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.models = config.models.map((m) => ({
      id: m.id,
      tool_call: m.tool_call,
      reasoning: m.reasoning,
      modalities: m.modalities,
      defaultParams: config.defaultParams,
    }));
  }

  getModel(modelId: string) {
    return this.client.chat(modelId);
  }

  listModels(): Record<string, ModelInfo> {
    return Object.fromEntries(this.models.map((m) => [m.id, m]));
  }

  getDefaultParams(): ModelDefaultParams {
    return this.defaultParams;
  }
}

export function apply(ctx: Context, config: Config) {
  const provider = new AnthropicProvider(config);
  ctx["yesimbot.model"].registerProvider(config.id, provider);
}
