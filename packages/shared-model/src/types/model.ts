import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { CallSettings, LanguageModel } from "ai";

export type ModelSelector = { provider: string; model: string };

export enum Modality {
  Audio = "audio",
  Image = "image",
  Pdf = "pdf",
  Text = "text",
  Video = "video",
}

export interface ModelInfo {
  id: string;
  tool_call?: boolean;
  reasoning?: boolean;
  modalities?: Modality[];
  cost?: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
    context_over_200k: {
      input: number;
      output: number;
      cache_read?: number;
      cache_write?: number;
    };
  };
  limit?: { context: number; input: number; output: number };
  headers?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface IModelProvider {
  readonly id: string;
  readonly providerType: string;
  readonly models: ModelInfo[];
  listModels(): Record<string, ModelInfo>;
  getModel(modelId: string): LanguageModel;
  getDefaultParams(): Partial<CallSettings>;
}

export interface IModelService {
  registerProvider(name: string, provider: IModelProvider): void;
  unregisterProvider(name: string): void;
  getProvider(name: string): IModelProvider | undefined;
  listProviders(): string[];
  getModelInfo(providerName: string, modelId: string): ModelInfo | undefined;
}

export type { LanguageModel, LanguageModelV3, CallSettings };
