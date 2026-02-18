import type { LanguageModel, CallSettings } from "ai";

export enum ModelCapability {
  ToolCalling = "tool-calling",
  Vision = "vision",
  JsonMode = "json-mode",
  Streaming = "streaming",
}

export interface ModelDefaultParams {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stopSequences?: string[];
  seed?: number;
}

export interface ModelInfo {
  id: string;
  capabilities: ModelCapability[];
  defaultParams?: ModelDefaultParams;
}

export interface IModelProvider {
  readonly instanceName: string;
  readonly providerType: string;
  readonly models: ModelInfo[];
  getModel(modelId: string): LanguageModel;
  getDefaultParams(modelId: string): ModelDefaultParams;
}

export interface IModelService {
  registerProvider(name: string, provider: IModelProvider): void;
  unregisterProvider(name: string): void;
  getProvider(name: string): IModelProvider | undefined;
  listProviders(): string[];
  getModelInfo(providerName: string, modelId: string): ModelInfo | undefined;
}

export interface ModelConfig {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export type { LanguageModel };
