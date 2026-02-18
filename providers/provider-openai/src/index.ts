import { createOpenAI } from "@ai-sdk/openai";
import {
  IModelProvider,
  ModelInfo,
  ModelCapability,
  ModelDefaultParams,
  IModelService,
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
  models: Array<{ id: string; capabilities: string[] }>;
  defaultParams: ModelDefaultParams;
}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("openai"),
  apiKey: Schema.string().role("secret").required(),
  baseURL: Schema.string().default("https://api.openai.com/v1"),
  models: Schema.array(
    Schema.object({
      id: Schema.string().required(),
      capabilities: Schema.array(Schema.string()),
    }),
  )
    .default([{ id: "gpt-4o", capabilities: ["toolCalling", "vision", "jsonMode", "streaming"] }])
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
  private client: ReturnType<typeof createOpenAI>;

  constructor(config: Config) {
    this.id = config.id;
    this.client = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
    this.models = config.models.map((m) => ({
      id: m.id,
      capabilities: m.capabilities.map((c) => {
        const map: Record<string, ModelCapability> = {
          toolCalling: ModelCapability.ToolCalling,
          vision: ModelCapability.Vision,
          jsonMode: ModelCapability.JsonMode,
          streaming: ModelCapability.Streaming,
        };
        return map[c] || (c as ModelCapability);
      }),
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
