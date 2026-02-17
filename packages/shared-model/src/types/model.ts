import type { LanguageModelV3 } from '@ai-sdk/provider'

export interface IModelProvider {
  readonly id: string
  readonly name: string
  getModel(modelId: string): LanguageModelV3
}

export interface ModelConfig {
  provider: string
  model: string
  temperature?: number
  maxTokens?: number
}

export type { LanguageModelV3 }
