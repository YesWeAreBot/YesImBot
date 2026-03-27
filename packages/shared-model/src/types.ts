import type { EmbeddingModelV3, LanguageModelV3 } from "@ai-sdk/provider";

/** provider:model 格式的完整标识 */
export type ModelId = `${string}:${string}`;

/** 模型条目，用于 UI 列表展示和能力查询 */
export interface ModelEntry {
  id: string;
  toolCall?: boolean;
  reasoning?: boolean;
}

/** provider 插件向 ModelRegistry 注册时实现此接口 */
export interface ModelProvider {
  readonly id: string;
  chat(modelId: string): LanguageModelV3;
  embedding?(modelId: string): EmbeddingModelV3;
  models(): ModelEntry[];
}

/** ModelService 对外暴露的注册表接口 */
export interface ModelRegistry {
  register(provider: ModelProvider): void;
  unregister(id: string): void;
  resolve(fullId: string): LanguageModelV3;
  resolveEmbedding(fullId: string): EmbeddingModelV3;
  getProvider(id: string): ModelProvider | undefined;
  listProviders(): string[];
  listModels(providerId?: string): ModelEntry[];
}

export function parseModelId(fullId: string): { provider: string; model: string } | null {
  const idx = fullId.indexOf(":");
  if (idx <= 0) return null;
  return { provider: fullId.slice(0, idx), model: fullId.slice(idx + 1) };
}
