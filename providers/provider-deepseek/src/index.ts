import { createDeepSeek } from "@ai-sdk/deepseek";
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
    "yesimbot.model": IModelService;
  }
}

export const name = "yesimbot-provider-deepseek";
export const inject = ["yesimbot.model"];

export interface Config {
  id: string;
  apiKey: string;
  baseURL: string;
  models: Array<{ id: string; capabilities: string[] }>;
  defaultParams: ModelDefaultParams;
}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("deepseek"),
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
  readonly id: string;
  readonly providerType = "deepseek";
  readonly models: ModelInfo[];
  private client: ReturnType<typeof createDeepSeek>;

  constructor(config: Config) {
    this.id = config.id;
    this.client = createDeepSeek({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.models = config.models.map((m) => ({
      id: m.id,
      capabilities: m.capabilities as ModelCapability[],
      defaultParams: config.defaultParams,
    }));
  }

  getModel(modelId: string) {
    return this.client.chat(modelId);
  }

  getDefaultParams(modelId: string): ModelDefaultParams {
    return this.models.find((m) => m.id === modelId)?.defaultParams || {};
  }
}

export function apply(ctx: Context, config: Config) {
  const provider = new DeepSeekProvider(config);
  const logger = ctx.logger("provider-deepseek");
  const modelService = ctx.get("yesimbot.model") as IModelService;
  if (!modelService) {
    logger.error("ModelService not found in context");
    return;
  }
  modelService.registerProvider(config.id, provider);
  ctx.on("dispose", () => modelService.unregisterProvider(config.id));
}
