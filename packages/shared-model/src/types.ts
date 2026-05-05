import { EmbeddingModel, LanguageModel } from "ai";

export type ModelId = `${string}:${string}`;

export const CHAT_MODEL_MODALITIES = ["text", "audio", "image", "video", "pdf"] as const;
export type ChatModelModality = (typeof CHAT_MODEL_MODALITIES)[number];

export interface ChatModelConfig {
  id: string;
  name?: string;
  toolCall?: boolean;
  reasoning?: boolean;
  limit?: {
    context: number;
    output: number;
  };
  modalities?: {
    input: ChatModelModality[];
    output: ChatModelModality[];
  };
  variants?: Record<string, unknown>;
}

export interface EmbeddingModelConfig {
  id: string;
  name?: string;
  dimension?: number;
}

export interface ModelProviderCapabilities {
  chat: boolean;
  embedding: boolean;
}

export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ModelProviderCapabilities;
  chatModels(): ChatModelConfig[];
  embeddingModels(): EmbeddingModelConfig[];
  chat(modelId: string): LanguageModel;
  embedding(modelId: string): EmbeddingModel;
}

export interface ChatModelRef {
  fullId: ModelId;
  providerId: string;
  modelId: string;
  entry: ChatModelConfig;
  model: LanguageModel;
}

export interface ModelRegistry {
  register(provider: ModelProvider): void;
  unregister(providerId: string): void;
  resolve(fullId: string): LanguageModel;
  resolveChatModel(fullId: string): ChatModelRef;
  resolveEmbedding(fullId: string): EmbeddingModel;
  getProvider(id: string): ModelProvider | undefined;
  listProviders(): string[];
  listChatModels(): Array<{ fullId: string; config: ChatModelConfig }>;
  listEmbeddingModels(): Array<{ fullId: string; config: EmbeddingModelConfig }>;
}

export function parseModelId(fullId: string): { provider: string; model: string } | null {
  const idx = fullId.indexOf(":");
  if (idx <= 0) return null;
  return { provider: fullId.slice(0, idx), model: fullId.slice(idx + 1) };
}

export function formatModelId(providerId: string, modelId: string): ModelId {
  return `${providerId}:${modelId}`;
}
