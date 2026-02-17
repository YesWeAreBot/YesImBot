import { createOpenAI } from "@ai-sdk/openai";
import type {
  IModelProvider,
  ModelInfo,
  ModelDefaultParams,
  ModelCapability,
  IModelService,
} from "@yesimbot/shared-model";
import { Context, Schema } from "koishi";

declare module "koishi" {
  interface Context {
    "model-service": IModelService;
  }
}

export const name = "yesimbot-provider-deepseek";
export const inject = ["model-service"];

export interface Config {
  instanceName: string;
  apiKey: string;
  baseURL: string;
  models: Array<{ id: string; capabilities: string[] }>;
  defaultParams: ModelDefaultParams;
}

export const Config: Schema<Config> = Schema.object({
  instanceName: Schema.string().required().description("Unique instance name"),
  apiKey: Schema.string().role("secret").required(),
  baseURL: Schema.string().default("https://api.deepseek.com/v1"),
  models: Schema.array(
    Schema.object({
      id: Schema.string().required(),
      capabilities: Schema.array(Schema.string()),
    }),
  ).default([
    { id: "deepseek-chat", capabilities: ["toolCalling", "jsonMode", "streaming"] },
    { id: "deepseek-reasoner", capabilities: ["streaming"] },
  ]),
  defaultParams: Schema.object({
    temperature: Schema.number().default(0.7),
    maxTokens: Schema.number().default(4096),
    topP: Schema.number().default(1.0),
  }),
});

class DeepSeekProvider implements IModelProvider {
  readonly instanceName: string;
  readonly providerType = "deepseek";
  readonly models: ModelInfo[];
  private client: ReturnType<typeof createOpenAI>;

  constructor(config: Config) {
    this.instanceName = config.instanceName;
    this.client = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.models = config.models.map((m) => ({
      id: m.id,
      capabilities: m.capabilities as ModelCapability[],
      defaultParams: config.defaultParams,
    }));
  }

  getModel(modelId: string) {
    return this.client(modelId);
  }

  getDefaultParams(modelId: string): ModelDefaultParams {
    return this.models.find((m) => m.id === modelId)?.defaultParams || {};
  }
}

export function apply(ctx: Context, config: Config) {
  const provider = new DeepSeekProvider(config);
  ctx["model-service"].registerProvider(config.instanceName, provider);
  ctx.on("dispose", () => ctx["model-service"].unregisterProvider(config.instanceName));
}
