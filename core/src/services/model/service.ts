import {
  classifyError,
  ErrorCategory,
  IModelProvider,
  IModelService,
  LanguageModel,
  LanguageModelV3,
  ModelInfo,
  ModelSelector,
  parseModelId,
} from "@yesimbot/shared-model";
import type { CallSettings, Prompt } from "ai";
import { extractReasoningMiddleware, generateText, streamText, wrapLanguageModel } from "ai";
import { Context, Schema, Service } from "koishi";
import PQueue from "p-queue";

declare module "koishi" {
  interface Context {
    "yesimbot.model": IModelService;
  }
  interface Events {
    "yesimbot/set-model": (provider: string, modelId: string) => void;
  }
}

export type CallParams = CallSettings & Prompt;
export type GenerateResult = Awaited<ReturnType<typeof generateText>>;
export type StreamResult = Awaited<ReturnType<typeof streamText>>;

export interface ModelServiceConfig {
  concurrency?: number;
  debugLevel?: number;
}

export class ModelService extends Service<ModelServiceConfig> implements IModelService {
  private providers = new Map<string, IModelProvider>();
  private queue: PQueue;
  private usage = new Map<string, { tokens: number; requests: number }>();

  constructor(ctx: Context, config: ModelServiceConfig) {
    super(ctx, "yesimbot.model", true);
    this.config = config;
    this.queue = new PQueue({ concurrency: config.concurrency || 5 });
    this.logger = ctx.logger("yesimbot.model");
    this.logger.level = config.debugLevel ?? 2;
    const command = this.ctx.command("yesimbot.model", "模型指令集", { authority: 3 });

    command
      .subcommand(".set <model:string>", "设置当前会话使用的模型")
      .action(({ session }, model) => {
        try {
          if (!model) return "请提供模型名称，格式为 provider:modelId";
          const { provider, modelId } = this.resolveModel(model);
          const providerInstance = this.getProvider(provider);
          if (!providerInstance) return `提供商未找到: ${provider}`;
          const modelInfo = providerInstance.getModel(modelId);
          if (!modelInfo) return `模型未找到: ${model}`;
          this.ctx.emit("yesimbot/set-model", provider, modelId);
          return `已设置当前会话使用模型: ${provider}:${modelId}`;
        } catch (error) {
          return `无效的模型格式: ${model}`;
        }
      });

    command.subcommand(".list", "列出当前会话可用的模型").action(() => {
      const providers = this.listProviders();
      if (providers.length === 0) return "没有注册的模型提供商";
      let data = "当前会话可用的模型:\n";
      for (const providerName of providers) {
        const provider = this.getProvider(providerName);
        if (!provider) continue;
        const models = provider.listModels();
        for (const modelId of Object.keys(models)) {
          data += `- ${providerName}:${modelId}\n`;
        }
      }
      return data;
    });

    const providerCommand = command.subcommand(".provider", "", { authority: 3 });
    providerCommand.subcommand(".list", "列出所有模型提供商").action(() => {
      const providers = this.listProviders();
      if (providers.length === 0) return "没有注册的模型提供商";
      return `共注册了 ${providers.length} 个模型提供商:\n` + providers.join("\n");
    });
    providerCommand
      .subcommand(".models <providerName:string>", "列出指定提供商的模型")
      .action(({ session, options }, providerName) => {
        if (!providerName) return "请提供模型提供商名称";
        const provder = this.getProvider(providerName);
        if (!provder) return `提供商未找到: ${providerName}`;
        const models = provder.listModels();
        if (Object.keys(models).length === 0) return "该提供商没有注册任何模型";
        const data =
          `提供商 ${providerName} 的模型列表:\n` +
          Object.entries(models)
            .map(([id, _info]) => id)
            .join("\n");
        return data;
      });

    this.refreshSchemas();
  }

  private refreshSchemas(): void {
    const options: Schema<string>[] = [];
    for (const [name, provider] of this.providers) {
      const models = provider.listModels();
      for (const [modelId, info] of Object.entries(models)) {
        options.push(
          Schema.const(`${name}:${modelId}` as string).description(`${name}:${modelId}`),
        );
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

  private resolveModel(model: string | ModelSelector): { provider: string; modelId: string } {
    if (typeof model === "string") {
      const parsed = parseModelId(model);
      if (!parsed) throw new Error("Invalid model format");
      if (!parsed.provider || !parsed.model) throw new Error("Provider and model required");
      return { provider: parsed.provider, modelId: parsed.model };
    }
    if (!model.provider || !model.model) throw new Error("Provider and model required");
    return { provider: model.provider, modelId: model.model };
  }

  private async withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const category = classifyError(error);
        if (category !== ErrorCategory.TRANSIENT && category !== ErrorCategory.RATE_LIMIT)
          throw error;
        if (i < retries) this.logger.warn(`Retry ${i + 1}/${retries} after transient error`);
      }
    }
    throw lastError;
  }

  public async call(
    model: string | ModelSelector,
    params: CallParams,
    fallbackChain?: string[],
  ): Promise<GenerateResult | undefined> {
    const { provider, modelId } = this.resolveModel(model);

    const result = await this.queue.add(async () => {
      try {
        return await this.withRetry(() => this.executeCall(provider, modelId, params));
      } catch (error) {
        const category = classifyError(error);
        if (category === ErrorCategory.TRANSIENT || category === ErrorCategory.RATE_LIMIT) {
          return await this.handleFallback(params, error, fallbackChain);
        }
        throw error;
      }
    });
    return result ?? undefined;
  }

  private async executeStreamCall(providerName: string, modelId: string, params: CallParams) {
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`Provider not found: ${providerName}`);

    const model = provider.getModel(modelId) as LanguageModelV3;
    const wrappedModel = wrapLanguageModel({
      model,
      middleware: [extractReasoningMiddleware({ tagName: "think" })],
    });
    const defaults = provider.getDefaultParams();
    const merged = { ...defaults, ...params };

    return await streamText({ model: wrappedModel, ...merged });
  }

  private async executeCall(providerName: string, modelId: string, params: CallParams) {
    const provider = this.providers.get(providerName);
    if (!provider) throw new Error(`Provider not found: ${providerName}`);

    const model = provider.getModel(modelId) as LanguageModelV3;
    const wrappedModel = wrapLanguageModel({
      model,
      middleware: [extractReasoningMiddleware({ tagName: "think" })],
    });
    const defaults = provider.getDefaultParams();
    const merged = { ...defaults, ...params };

    const result = await generateText({ model: wrappedModel, ...merged });

    // Log cache token usage if present (Anthropic prompt caching)
    const cacheWrite = result.usage?.inputTokenDetails?.cacheWriteTokens ?? 0;
    const cacheRead = result.usage?.inputTokenDetails?.cacheReadTokens ?? 0;
    if (cacheWrite > 0 || cacheRead > 0) {
      this.logger.debug(
        `cache provider=${providerName} model=${modelId} write=${cacheWrite} read=${cacheRead}`,
      );
    }

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
    fallbackChain?: string[],
  ): Promise<StreamResult> {
    const { provider, modelId } = this.resolveModel(model);

    const result = await this.queue.add(async () => {
      try {
        return await this.withRetry(() => this.executeStreamCall(provider, modelId, params));
      } catch (error) {
        const category = classifyError(error);
        if (category === ErrorCategory.TRANSIENT || category === ErrorCategory.RATE_LIMIT) {
          return await this.handleStreamFallback(params, error, fallbackChain);
        }
        throw error;
      }
    });
    if (!result) throw new Error("Queue returned undefined for stream call");
    return result;
  }

  public getModel(model: string | ModelSelector): {
    model: LanguageModel;
    defaultParams: Partial<CallSettings>;
  } {
    const { provider, modelId } = this.resolveModel(model);
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

  private async handleFallback(params: CallParams, error: unknown, chain?: string[]) {
    if (!chain || chain.length === 0) throw error;

    for (const fallback of chain) {
      const parsed = parseModelId(fallback);
      if (!parsed) continue;
      const { provider, model } = parsed;
      if (!provider || !model) continue;
      try {
        this.logger.warn(`Trying fallback chain model: ${fallback}`);
        return await this.executeCall(provider, model, params);
      } catch (e) {
        continue;
      }
    }

    throw error;
  }

  private async handleStreamFallback(params: CallParams, error: unknown, chain?: string[]) {
    if (!chain || chain.length === 0) throw error;

    for (const fallback of chain) {
      const parsed = parseModelId(fallback);
      if (!parsed) continue;
      const { provider, model } = parsed;
      if (!provider || !model) continue;
      try {
        this.logger.warn(`Trying fallback chain model: ${fallback}`);
        return await this.executeStreamCall(provider, model, params);
      } catch (e) {
        continue;
      }
    }

    throw error;
  }
}
