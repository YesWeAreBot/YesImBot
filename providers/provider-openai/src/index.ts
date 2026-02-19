import { createOpenAI } from "@ai-sdk/openai";
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

export const name = "yesimbot-provider-openai";
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
  id: Schema.string().default("openai"),
  apiKey: Schema.string().role("secret").required(),
  baseURL: Schema.string().default("https://api.openai.com/v1"),
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
        id: "gpt-4o",
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

class OpenAIProvider implements IModelProvider {
  readonly id: string;
  readonly providerType = "openai";
  readonly models: ModelInfo[];
  readonly defaultParams: ModelDefaultParams;
  private client: ReturnType<typeof createOpenAI>;

  constructor(config: Config) {
    this.id = config.id;
    this.defaultParams = config.defaultParams;
    this.client = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
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
  const provider = new OpenAIProvider(config);
  const logger = ctx.logger("provider-openai");
  const modelService = ctx.get("yesimbot.model") as IModelService;
  if (!modelService) {
    logger.error("ModelService not found in context");
    return;
  }
  modelService.registerProvider(config.id, provider);
  ctx.on("dispose", () => modelService.unregisterProvider(config.id));
}
