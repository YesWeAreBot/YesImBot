import { dirname, join } from "node:path";

import type {
  ChatModelRef,
  ChatModelConfig,
  EmbeddingModelConfig,
  ModelId,
  ModelProvider,
  ModelRegistry,
} from "@yesimbot/agent/ai";
import { formatModelId, parseModelId } from "@yesimbot/agent/ai";
import { Context, Schema, Service } from "koishi";

import { loadModelsConfig } from "./models-config";

export interface ModelServiceConfig {
  basePath: string;
  logLevel?: number;
  modelsConfigPath?: string;
}

function cloneChatModelConfig(config: ChatModelConfig): ChatModelConfig {
  return { ...config };
}

function cloneEmbeddingModelConfig(config: EmbeddingModelConfig): EmbeddingModelConfig {
  return { ...config };
}

type ChatModelView = ChatModelConfig & { hidden?: boolean };
type EmbeddingModelView = EmbeddingModelConfig & { hidden?: boolean };

function cloneChatModelView(config: ChatModelView): ChatModelView {
  return { ...config };
}

function cloneEmbeddingModelView(config: EmbeddingModelView): EmbeddingModelView {
  return { ...config };
}

interface ChatModelRecord {
  fullId: ModelId;
  providerId: string;
  modelId: string;
  config: ChatModelConfig;
}

interface EmbeddingModelRecord {
  fullId: ModelId;
  providerId: string;
  modelId: string;
  config: EmbeddingModelConfig;
}

function isHiddenModel(config: { hidden?: boolean } | undefined): boolean {
  return config?.hidden === true;
}

export class ModelService extends Service<ModelServiceConfig> implements ModelRegistry {
  private providers = new Map<string, ModelProvider>();
  private chatModels = new Map<string, ChatModelRecord>();
  private embeddingModels = new Map<string, EmbeddingModelRecord>();
  private aliases = new Map<string, ModelId>();
  private defaults: {
    chat?: ModelId;
    embedding?: ModelId;
  } = {};

  constructor(ctx: Context, config: ModelServiceConfig) {
    super(ctx, "yesimbot.model", true);
    this.config = config;
    this.logger.level = config.logLevel ?? 2;
  }

  private getModelsConfigPath(): string | undefined {
    if (this.config.modelsConfigPath) {
      return this.config.modelsConfigPath;
    }

    return join(this.ctx.baseDir, dirname(this.config.basePath), "models.json");
  }

  private refreshSchemas(): void {
    const options: Schema<string>[] = [];
    for (const model of this.chatModels.values()) {
      if (isHiddenModel(model.config as ChatModelView)) {
        continue;
      }
      const fullId = model.fullId as string;
      options.push(Schema.const(fullId).description(fullId));
    }
    options.push(Schema.string().description("Custom model (provider:model)"));
    this.ctx.schema.set("registry.chatModels", Schema.union(options).default(""));
  }

  private refreshModels(): void {
    this.chatModels.clear();
    this.embeddingModels.clear();
    this.aliases.clear();
    this.defaults = {};

    for (const provider of this.providers.values()) {
      if (provider.capabilities.chat) {
        for (const config of provider.chatModels()) {
          const fullId = formatModelId(provider.id, config.id);
          this.chatModels.set(fullId, {
            fullId,
            providerId: provider.id,
            modelId: config.id,
            config: cloneChatModelConfig(config),
          });
        }
      }

      if (provider.capabilities.embedding) {
        for (const config of provider.embeddingModels()) {
          const fullId = formatModelId(provider.id, config.id);
          this.embeddingModels.set(fullId, {
            fullId,
            providerId: provider.id,
            modelId: config.id,
            config: cloneEmbeddingModelConfig(config),
          });
        }
      }
    }

    const { config: modelsConfig, warnings } = loadModelsConfig(this.getModelsConfigPath());
    for (const warning of warnings) {
      this.logger.warn(warning);
    }

    for (const [fullId, override] of Object.entries(modelsConfig.chat)) {
      const record = this.chatModels.get(fullId);
      if (!record) {
        this.logger.warn(`Ignoring models.json chat override for unknown model "${fullId}".`);
        continue;
      }
      record.config = {
        ...record.config,
        name: override.name ?? record.config.name,
        toolCall: override.toolCall ?? record.config.toolCall,
        reasoning: override.reasoning ?? record.config.reasoning,
        hidden: override.hidden ?? (record.config as ChatModelView).hidden,
      } as ChatModelView;
    }

    for (const [fullId, override] of Object.entries(modelsConfig.embedding)) {
      const record = this.embeddingModels.get(fullId);
      if (!record) {
        this.logger.warn(`Ignoring models.json embedding override for unknown model "${fullId}".`);
        continue;
      }
      record.config = {
        ...record.config,
        name: override.name ?? record.config.name,
        hidden: override.hidden ?? (record.config as EmbeddingModelView).hidden,
      } as EmbeddingModelView;
    }

    for (const [alias, target] of Object.entries(modelsConfig.aliases)) {
      if (this.chatModels.has(alias) || this.embeddingModels.has(alias)) {
        this.logger.warn(
          `Ignoring models.json alias "${alias}" because it conflicts with a full model id.`,
        );
        continue;
      }
      if (!parseModelId(target)) {
        this.logger.warn(
          `Ignoring models.json alias "${alias}" because target "${target}" is not a valid model id.`,
        );
        continue;
      }
      if (!this.chatModels.has(target) && !this.embeddingModels.has(target)) {
        this.logger.warn(
          `Ignoring models.json alias "${alias}" because target "${target}" is not registered.`,
        );
        continue;
      }
      this.aliases.set(alias, target as ModelId);
    }

    if (modelsConfig.defaults.chat) {
      if (this.chatModels.has(modelsConfig.defaults.chat)) {
        this.defaults.chat = modelsConfig.defaults.chat as ModelId;
      } else {
        this.logger.warn(
          `Ignoring models.json chat default "${modelsConfig.defaults.chat}" because it is not a registered chat model.`,
        );
      }
    }

    if (modelsConfig.defaults.embedding) {
      if (this.embeddingModels.has(modelsConfig.defaults.embedding)) {
        this.defaults.embedding = modelsConfig.defaults.embedding as ModelId;
      } else {
        this.logger.warn(
          `Ignoring models.json embedding default "${modelsConfig.defaults.embedding}" because it is not a registered embedding model.`,
        );
      }
    }

    this.refreshSchemas();
  }

  private resolveInput(input: string): string {
    return this.aliases.get(input) ?? input;
  }

  private getChatRecord(fullId: string): ChatModelRecord {
    fullId = this.resolveInput(fullId);
    const parsed = parseModelId(fullId);
    if (!parsed) throw new Error(`Invalid model ID format: ${fullId}`);

    const provider = this.providers.get(parsed.provider);
    if (!provider) {
      throw new Error(
        `Provider "${parsed.provider}" not found. Available: [${this.listProviders().join(", ")}]`,
      );
    }

    if (!provider.capabilities.chat) {
      throw new Error(`Provider "${parsed.provider}" does not support chat`);
    }

    const record = this.chatModels.get(fullId);
    if (record) return record;

    const available = [...this.chatModels.values()]
      .filter((item) => item.providerId === parsed.provider)
      .map((item) => item.modelId)
      .join(", ");
    throw new Error(
      `Model "${parsed.model}" not found in provider "${parsed.provider}". Available: [${available}]`,
    );
  }

  private getEmbeddingRecord(fullId: string): EmbeddingModelRecord {
    fullId = this.resolveInput(fullId);
    const parsed = parseModelId(fullId);
    if (!parsed) throw new Error(`Invalid model ID format: ${fullId}`);

    const provider = this.providers.get(parsed.provider);
    if (!provider) throw new Error(`Provider "${parsed.provider}" not found`);

    if (!provider.capabilities.embedding) {
      throw new Error(`Provider "${parsed.provider}" does not support embedding`);
    }

    const record = this.embeddingModels.get(fullId);
    if (record) return record;

    const available = [...this.embeddingModels.values()]
      .filter((item) => item.providerId === parsed.provider)
      .map((item) => item.modelId)
      .join(", ");
    throw new Error(
      `Model "${parsed.model}" not found in provider "${parsed.provider}". Available: [${available}]`,
    );
  }

  register(provider: ModelProvider) {
    this.providers.set(provider.id, provider);
    this.refreshModels();
    this.logger.info(`Provider registered: ${provider.id}`);
  }

  unregister(providerName: string) {
    this.providers.delete(providerName);
    this.refreshModels();
    this.logger.info(`Provider unregistered: ${providerName}`);
  }

  resolve(fullId: string) {
    return this.resolveChatModel(fullId).model;
  }

  resolveChatModel(fullId: string): ChatModelRef {
    const record = this.getChatRecord(fullId);
    const provider = this.providers.get(record.providerId);
    if (!provider) {
      throw new Error(`Provider "${record.providerId}" not found`);
    }

    return {
      fullId: record.fullId,
      providerId: record.providerId,
      modelId: record.modelId,
      entry: cloneChatModelView(record.config as ChatModelView),
      model: provider.chat(record.modelId),
    };
  }

  resolveEmbedding(fullId: string) {
    const record = this.getEmbeddingRecord(fullId);
    const provider = this.providers.get(record.providerId);
    if (!provider) throw new Error(`Provider "${record.providerId}" not found`);
    return provider.embedding(record.modelId);
  }

  getProvider(id: string) {
    return this.providers.get(id);
  }

  listProviders() {
    return [...this.providers.keys()];
  }

  getDefaultChatModelId(): ModelId | undefined {
    return this.defaults.chat;
  }

  getDefaultEmbeddingModelId(): ModelId | undefined {
    return this.defaults.embedding;
  }

  listChatModels(): Array<{ fullId: string; config: ChatModelConfig }> {
    return [...this.chatModels.values()].map((record) => ({
      fullId: record.fullId,
      config: cloneChatModelView(record.config as ChatModelView),
    }));
  }

  listEmbeddingModels(): Array<{ fullId: string; config: EmbeddingModelConfig }> {
    return [...this.embeddingModels.values()].map((record) => ({
      fullId: record.fullId,
      config: cloneEmbeddingModelView(record.config as EmbeddingModelView),
    }));
  }
}
