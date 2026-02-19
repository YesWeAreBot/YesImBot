import {
  classifyError,
  ErrorCategory,
  IModelProvider,
  IModelService,
  ModelDefaultParams,
  ModelInfo,
  ModelSelector,
} from "@yesimbot/shared-model";
import { parseModelId } from "@yesimbot/shared-model";
import { type CallSettings, LanguageModel, type Prompt, generateText, streamText } from "ai";
import { Context, Schema, Service } from "koishi";
import PQueue from "p-queue";

declare module "koishi" {
  interface Context {
    "yesimbot.model": ModelService;
  }
}

export type CallParams = CallSettings & Prompt;
export type GenerateResult = Awaited<ReturnType<typeof generateText>>;
export type StreamResult = Awaited<ReturnType<typeof streamText>>;

export interface ModelServiceConfig {
  defaultModel?: string;
  fallbackChains?: string[];
  concurrency?: number;
}

export class ModelService extends Service<ModelServiceConfig> implements IModelService {
  private providers = new Map<string, IModelProvider>();
  private queue: PQueue;
  private usage = new Map<string, { tokens: number; requests: number }>();

  static inject = ["console"];

  constructor(ctx: Context, config: ModelServiceConfig) {
    super(ctx, "yesimbot.model", true);
    this.config = config;
    this.queue = new PQueue({ concurrency: config.concurrency || 5 });
    this.logger = ctx.logger("yesimbot.model");
    this.refreshSchemas();
  }

  private refreshSchemas(): void {
    const options: Schema<string>[] = [];
    for (const [name, provider] of this.providers) {
      const models = provider.listModels();
      for (const [modelId, info] of Object.entries(models)) {
        options.push(Schema.const(`${name}:${modelId}` as string).description(modelId));
      }
    }
    options.push(Schema.string().description("Custom model (provider:model)"));
    this.ctx.schema.set("registry.chatModels", Schema.union(options).default(""));
  }

  public registerProvider(name: string, provider: IModelProvider): void {
    this.providers.set(name, provider);
    this.logger.info(`Provider registered: ${name}`);
    const caller = this[Context.current];
    caller.on("dispose", () => {
      this.unregisterProvider(name);
    });
    this.refreshSchemas();
  }

  public unregisterProvider(name: string): void {
    this.providers.delete(name);
    this.logger.info(`Provider unregistered: ${name}`);
    this.refreshSchemas();
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
    model: string | ModelSelector,
    params: CallParams,
  ): Promise<GenerateResult | undefined> {
    let provider: string;
    let modelId: string;
    if (typeof model === "string") {
      const parsed = parseModelId(model);
      if (!parsed) {
        throw new Error("Invalid model format");
      }
      provider = parsed.provider;
      modelId = parsed.model;
    } else {
      provider = model.provider;
      modelId = model.model;
    }
    if (!provider || !modelId) {
      throw new Error("Provider and model required");
    }

    const result = await this.queue.add(async () => {
      try {
        return await this.executeCall(provider, modelId, params);
      } catch (error) {
        const category = classifyError(error);
        if (category === ErrorCategory.TRANSIENT || category === ErrorCategory.RATE_LIMIT) {
          return await this.handleFallback(params, error);
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
    const defaults = provider.getDefaultParams();
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
    model: string | ModelSelector,
    params: CallParams,
  ): Promise<StreamResult> {
    let provider: string;
    let modelId: string;
    if (typeof model === "string") {
      const parsed = parseModelId(model);
      if (!parsed) {
        throw new Error("Invalid model format");
      }
      provider = parsed.provider;
      modelId = parsed.model;
    } else {
      provider = model.provider;
      modelId = model.model;
    }
    if (!provider || !modelId) throw new Error("Provider and model required");

    const result = await this.queue.add(async () => {
      try {
        const p = this.providers.get(provider);
        if (!p) throw new Error(`Provider not found: ${provider}`);

        const m = p.getModel(modelId);
        const defaults = p.getDefaultParams();
        const merged = { ...defaults, ...params };

        return await streamText({ model: m, ...merged });
      } catch (error) {
        const category = classifyError(error);
        if (category === ErrorCategory.TRANSIENT || category === ErrorCategory.RATE_LIMIT) {
          return await this.handleStreamFallback(params, error);
        }
        throw error;
      }
    });
    if (!result) throw new Error("Queue returned undefined for stream call");
    return result;
  }

  public getModel(model: string | ModelSelector): {
    model: LanguageModel;
    defaultParams: ModelDefaultParams;
  } {
    let provider: string;
    let modelId: string;
    if (typeof model === "string") {
      const parsed = parseModelId(model);
      if (!parsed) {
        throw new Error("Invalid model format");
      }
      provider = parsed.provider;
      modelId = parsed.model;
    } else {
      provider = model.provider;
      modelId = model.model;
    }
    if (!provider || !modelId) {
      throw new Error("Provider and model required");
    }

    const p = this.providers.get(provider);
    if (!p) throw new Error(`Provider not found: ${provider}`);

    return {
      model: p.getModel(modelId),
      defaultParams: p.getDefaultParams(),
    };
  }

  public getUsage() {
    return new Map(this.usage);
  }

  private async handleFallback(params: CallParams, error: unknown) {
    const chain = this.config.fallbackChains;

    if (!chain || chain.length === 0) throw error;

    for (const fallback of chain) {
      const parsed = parseModelId(fallback);
      if (!parsed) continue;
      const { provider, model } = parsed;
      if (!provider || !model) continue;
      try {
        return await this.executeCall(provider, model, params);
      } catch (e) {
        continue;
      }
    }

    throw error;
  }

  private async handleStreamFallback(params: CallParams, error: unknown) {
    const chain = this.config.fallbackChains;

    if (!chain || chain.length === 0) throw error;

    for (const fallback of chain) {
      const parsed = parseModelId(fallback);
      if (!parsed) continue;
      const { provider, model } = parsed;
      if (!provider || !model) continue;
      try {
        const p = this.providers.get(provider);
        if (!p) continue;

        const m = p.getModel(model);
        const defaults = p.getDefaultParams();
        const merged = { ...defaults, ...params };

        return await streamText({ model: m, ...merged });
      } catch (e) {
        continue;
      }
    }

    throw error;
  }
}
