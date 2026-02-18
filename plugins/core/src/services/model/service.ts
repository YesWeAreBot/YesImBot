import {
  classifyError,
  ErrorCategory,
  IModelProvider,
  IModelService,
  ModelInfo,
} from "@yesimbot/shared-model";
import { type CallSettings, type Prompt, generateText, streamText } from "ai";
import { Context, Service } from "koishi";
import PQueue from "p-queue";

declare module "koishi" {
  interface Context {
    "model-service": ModelService;
  }
}

type CallParams = CallSettings & Prompt;
export type GenerateResult = Awaited<ReturnType<typeof generateText>>;
export type StreamResult = Awaited<ReturnType<typeof streamText>>;

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
    this.logger = ctx.logger("model-service");
  }

  public registerProvider(name: string, provider: IModelProvider): void {
    this.providers.set(name, provider);
    this.logger.info(`Provider registered: ${name}`);
  }

  public unregisterProvider(name: string): void {
    this.providers.delete(name);
    this.logger.info(`Provider unregistered: ${name}`);
  }

  public getProvider(name: string): IModelProvider | undefined {
    return this.providers.get(name);
  }

  public listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  public getModelInfo(providerName: string, modelId: string): ModelInfo | undefined {
    const provider = this.providers.get(providerName);
    return provider?.models.find((m) => m.id === modelId);
  }

  public async call(
    providerName: string | undefined,
    modelId: string | undefined,
    params: CallParams,
  ): Promise<GenerateResult | undefined> {
    const provider = providerName || this.config.defaultProvider;
    const model = modelId || this.config.defaultModel;
    if (!provider || !model) throw new Error("Provider and model required");

    const result = await this.queue.add(async () => {
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
    return result ?? undefined;
  }

  private async executeCall(providerName: string, modelId: string, params: CallParams) {
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

  public async streamCall(
    providerName: string | undefined,
    modelId: string | undefined,
    params: CallParams,
  ): Promise<StreamResult> {
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

  public getModel(providerName: string, modelId: string) {
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`Provider not found: ${providerName}`);

    return {
      model: provider.getModel(modelId),
      defaultParams: provider.getDefaultParams(modelId),
    };
  }

  public getUsage() {
    return new Map(this.usage);
  }

  private async handleFallback(
    primaryProvider: string,
    primaryModel: string,
    params: CallParams,
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
    params: CallParams,
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
