import type { EmbeddingModelV3 } from "@ai-sdk/provider";
import type { CallSettings, LanguageModel } from "ai";
import type { Context } from "koishi";

import type { IModelProvider, IModelService, ModelInfo } from "../types/model";

export interface ProviderClient {
  chat(modelId: string): LanguageModel;
  textEmbeddingModel?(modelId: string): EmbeddingModelV3;
}

export interface BaseProviderConfig {
  id: string;
  apiKey: string;
  baseURL: string;
  models: ModelInfo[];
  defaultParams?: Partial<CallSettings>;
  advancedOverride?: string;
}

declare module "koishi" {
  interface Context {
    "yesimbot.model": IModelService;
  }
}

export abstract class AbstractProvider<
  TClient extends ProviderClient,
  TConfig extends BaseProviderConfig,
> implements IModelProvider {
  readonly id: string;
  readonly models: ModelInfo[];
  abstract readonly providerType: string;
  protected client: TClient;
  protected ctx: Context;
  protected config: TConfig;
  private resolvedDefaultParams: Partial<CallSettings>;

  constructor(ctx: Context, config: TConfig) {
    this.ctx = ctx;
    this.config = config;
    this.id = config.id;
    this.client = this.createClient(config);
    this.models = config.models.map((m) => ({
      id: m.id,
      tool_call: m.tool_call,
      reasoning: m.reasoning,
      modalities: m.modalities,
    }));
    this.resolvedDefaultParams = this.buildDefaultParams(config);
    ctx["yesimbot.model"].registerProvider(config.id, this);
  }

  protected abstract createClient(config: TConfig): TClient;

  getModel(modelId: string): LanguageModel {
    return this.client.chat(modelId);
  }

  listModels(): Record<string, ModelInfo> {
    return Object.fromEntries(this.models.map((m) => [m.id, m]));
  }

  getDefaultParams(): Partial<CallSettings> {
    return this.resolvedDefaultParams;
  }

  private buildDefaultParams(config: TConfig): Partial<CallSettings> {
    const base: Partial<CallSettings> = config.defaultParams ?? {};
    if (!config.advancedOverride) return base;

    try {
      const override = JSON.parse(config.advancedOverride);
      if (override && typeof override === "object") {
        return { ...base, ...override };
      }
    } catch {
      const logger = this.ctx.logger("abstract-provider");
      logger.warn("Failed to parse advancedOverride JSON — ignoring override");
    }
    return base;
  }
}
