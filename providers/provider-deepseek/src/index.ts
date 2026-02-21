import { createDeepSeek } from "@ai-sdk/deepseek";
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

export const name = "yesimbot-provider-deepseek";
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
  id: Schema.string().default("deepseek"),
  apiKey: Schema.string().role("secret").required(),
  baseURL: Schema.string().default("https://api.deepseek.com/v1"),
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
        id: "deepseek-chat",
        tool_call: true,
        reasoning: false,
        modalities: [Modality.Text, Modality.Image],
      },
      {
        id: "deepseek-reasoner",
        tool_call: true,
        reasoning: true,
        modalities: [Modality.Text],
      },
    ])
    .role("table"),
  defaultParams: Schema.object({
    temperature: Schema.number().default(0.7),
    maxTokens: Schema.number().default(2048),
    topP: Schema.number().default(1.0),
  }),
});

class DeepSeekProvider implements IModelProvider {
  readonly id: string;
  readonly providerType = "deepseek";
  readonly models: ModelInfo[];
  private client: ReturnType<typeof createDeepSeek>;
  readonly defaultParams: ModelDefaultParams;

  constructor(config: Config) {
    this.id = config.id;
    this.client = createDeepSeek({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.defaultParams = config.defaultParams;
    this.models = config.models.map((m) => ({
      id: m.id,
      tool_call: m.tool_call,
      reasoning: m.reasoning,
      modalities: m.modalities,
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
  const provider = new DeepSeekProvider(config);
  ctx["yesimbot.model"].registerProvider(config.id, provider);
}
