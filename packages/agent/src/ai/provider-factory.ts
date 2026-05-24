import type { EmbeddingModel, LanguageModel } from "ai";

import type {
  ChatModelConfig,
  EmbeddingModelConfig,
  ModelProvider,
  ModelProviderCapabilities,
} from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BaseProviderConfig {
  id: string;
  apiKey: string;
  baseURL?: string;
  chatModels: ChatModelConfig[];
  embeddingModels?: EmbeddingModelConfig[];
}

/**
 * Minimal context interface the factory needs from the host framework.
 * Koishi's `Context` satisfies this via module augmentation on
 * `ctx["yesimbot.model"]`.
 */
export interface ProviderContext {
  "yesimbot.model": {
    register(provider: ModelProvider): void;
    unregister(providerId: string): void;
  };
  on(event: "dispose", callback: () => void): void;
}

export interface ProviderPluginOptions<TConfig extends BaseProviderConfig, TClient> {
  /** Koishi plugin name, e.g. "yesimbot-provider-openai" */
  name: string;
  /** Default provider id, e.g. "openai" */
  defaultId: string;
  /** Static capability flags */
  capabilities: ModelProviderCapabilities;
  /** Koishi Config schema — attached to the plugin object so Koishi can validate config */
  Config: any;
  /** Create the SDK client from config */
  createClient: (config: { apiKey: string; baseURL?: string }) => TClient;
  /** Adapt SDK client + modelId → LanguageModel */
  chat: (client: TClient, modelId: string, config: TConfig) => LanguageModel;
  /** Adapt SDK client + modelId → EmbeddingModel (omit when capabilities.embedding is false) */
  embedding?: (client: TClient, modelId: string, config: TConfig) => EmbeddingModel;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Koishi plugin that registers a ModelProvider.
 *
 * Eliminates the ~60-line boilerplate shared by every provider: client
 * construction, ModelProvider object, register/unregister lifecycle, and
 * the "no embedding" throw pattern.
 */
export function createProviderPlugin<TConfig extends BaseProviderConfig, TClient>(
  options: ProviderPluginOptions<TConfig, TClient>,
): {
  name: string;
  reusable: boolean;
  inject: string[];
  Config: any;
  apply: (ctx: ProviderContext, config: TConfig) => void;
} {
  const { name, capabilities, Config, createClient, chat, embedding } = options;

  return {
    name,
    reusable: true,
    inject: ["yesimbot.model"],
    Config,
    apply(ctx: ProviderContext, config: TConfig) {
      const client = createClient({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      });

      const provider: ModelProvider = {
        id: config.id,
        capabilities,
        chatModels: () => config.chatModels,
        embeddingModels: () => (capabilities.embedding ? (config.embeddingModels ?? []) : []),
        chat: (modelId) => chat(client, modelId, config),
        embedding: capabilities.embedding
          ? (modelId) => embedding!(client, modelId, config)
          : () => {
              throw new Error(`Provider "${config.id}" does not support embedding`);
            },
      };

      ctx["yesimbot.model"].register(provider);
      ctx.on("dispose", () => ctx["yesimbot.model"].unregister(config.id));
    },
  };
}
