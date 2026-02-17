import {
  IModelProvider,
  IModelService,
  ModelInfo,
  ModelError,
  ErrorCategory,
  classifyError,
  ModelDefaultParams,
} from "@yesimbot/shared-model";
import { generateText, streamText } from "ai";
import { Context, Service } from "koishi";
import PQueue from "p-queue";

declare module "koishi" {
  interface Context {
    "model-service": ModelService;
  }
}

export interface ModelServiceConfig {
  defaultProvider?: string;
  defaultModel?: string;
  fallbackChains?: Record<string, Array<{ provider: string; model: string }>>;
  concurrency?: number;
}

export class ModelService extends Service<ModelServiceConfig> implements IModelService {
  private providers = new Map<string, IModelProvider>();
  private queue: PQueue;
  private usage = new Map<string, { tokens: number; requests: number }>();

  static inject = ["console"];

  constructor(ctx: Context, config: ModelServiceConfig = {}) {
    super(ctx, "model-service", true);
    this.queue = new PQueue({ concurrency: config.concurrency || 5 });
  }

  registerProvider(name: string, provider: IModelProvider): void {
    this.providers.set(name, provider);
    this.ctx.logger("model-service").info(`Provider registered: ${name}`);
  }

  unregisterProvider(name: string): void {
    this.providers.delete(name);
    this.ctx.logger("model-service").info(`Provider unregistered: ${name}`);
  }

  getProvider(name: string): IModelProvider | undefined {
    return this.providers.get(name);
  }

  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  getModelInfo(providerName: string, modelId: string): ModelInfo | undefined {
    const provider = this.providers.get(providerName);
    return provider?.models.find((m) => m.id === modelId);
  }

  async call(providerName?: string, modelId?: string, params: any = {}) {
    const provider = providerName || this.config.defaultProvider;
    const model = modelId || this.config.defaultModel;
    if (!provider || !model) throw new Error("Provider and model required");

    return this.queue.add(async () => {
      try {
        return await this.executeCall(provider, model, params);
      } catch (error) {
        const category = classifyError(error);
        if (category === ErrorCategory.TRANSIENT || category === ErrorCategory.RATE_LIMIT) {
          return await this.handleFallback(provider, model, params, error);
        }
        throw error;
      }
    });
  }

  private async executeCall(providerName: string, modelId: string, params: any) {
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`Provider not found: ${providerName}`);

    const model = provider.getModel(modelId);
    const defaults = provider.getDefaultParams(modelId);
    const merged = { ...defaults, ...params };

    const result = await generateText({ model, ...merged });

    const key = `${providerName}:${modelId}`;
    const current = this.usage.get(key) || { tokens: 0, requests: 0 };
    this.usage.set(key, {
      tokens: current.tokens + (result.usage?.totalTokens || 0),
      requests: current.requests + 1,
    });

    return result;
  }

  async streamCall(providerName?: string, modelId?: string, params: any = {}) {
    const provider = providerName || this.config.defaultProvider;
    const model = modelId || this.config.defaultModel;
    if (!provider || !model) throw new Error("Provider and model required");

    try {
      const p = this.providers.get(provider);
      if (!p) throw new Error(`Provider not found: ${provider}`);

      const m = p.getModel(model);
      const defaults = p.getDefaultParams(model);
      const merged = { ...defaults, ...params };

      return await streamText({ model: m, ...merged });
    } catch (error) {
      const category = classifyError(error);
      if (category === ErrorCategory.TRANSIENT || category === ErrorCategory.RATE_LIMIT) {
        return await this.handleStreamFallback(provider, model, params, error);
      }
      throw error;
    }
  }

  getModel(providerName: string, modelId: string) {
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`Provider not found: ${providerName}`);

    return {
      model: provider.getModel(modelId),
      defaultParams: provider.getDefaultParams(modelId),
    };
  }

  getUsage() {
    return new Map(this.usage);
  }

  private async handleFallback(
    primaryProvider: string,
    primaryModel: string,
    params: any,
    error: unknown,
  ) {
    const key = `${primaryProvider}:${primaryModel}`;
    const chain = this.config.fallbackChains?.[key];

    if (!chain || chain.length === 0) throw error;

    for (const fallback of chain) {
      try {
        return await this.executeCall(fallback.provider, fallback.model, params);
      } catch (e) {
        continue;
      }
    }

    throw error;
  }

  private async handleStreamFallback(
    primaryProvider: string,
    primaryModel: string,
    params: any,
    error: unknown,
  ) {
    const key = `${primaryProvider}:${primaryModel}`;
    const chain = this.config.fallbackChains?.[key];

    if (!chain || chain.length === 0) throw error;

    for (const fallback of chain) {
      try {
        const p = this.providers.get(fallback.provider);
        if (!p) continue;

        const m = p.getModel(fallback.model);
        const defaults = p.getDefaultParams(fallback.model);
        const merged = { ...defaults, ...params };

        return await streamText({ model: m, ...merged });
      } catch (e) {
        continue;
      }
    }

    throw error;
  }
}
