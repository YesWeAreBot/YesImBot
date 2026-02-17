import type { LanguageModelV1 } from 'ai'

export interface IModelProvider {
  readonly id: string
  readonly name: string
  getModel(modelId: string): LanguageModelV1
}

export interface ModelConfig {
  provider: string
  model: string
  temperature?: number
  maxTokens?: number
}

export type { LanguageModelV1 }
