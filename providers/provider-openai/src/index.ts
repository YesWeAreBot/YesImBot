import { Context, Schema } from 'koishi'
import { createOpenAI } from '@ai-sdk/openai'
import { IModelProvider, ModelInfo, ModelCapability, ModelDefaultParams, IModelService } from '@yesimbot/shared-model'

declare module 'koishi' {
  interface Context {
    'model-service': IModelService
  }
}

export const name = 'yesimbot-provider-openai'
export const inject = ['model-service']

export interface Config {
  instanceName: string
  apiKey: string
  baseURL: string
  models: Array<{ id: string; capabilities: string[] }>
  defaultParams: ModelDefaultParams
}

export const Config: Schema<Config> = Schema.object({
  instanceName: Schema.string().required().description('Unique instance name'),
  apiKey: Schema.string().role('secret').required(),
  baseURL: Schema.string().default('https://api.openai.com/v1'),
  models: Schema.array(Schema.object({
    id: Schema.string().required(),
    capabilities: Schema.array(Schema.string())
  })).default([{ id: 'gpt-4o', capabilities: ['toolCalling', 'vision', 'jsonMode', 'streaming'] }]),
  defaultParams: Schema.object({
    temperature: Schema.number().default(0.7),
    maxTokens: Schema.number().default(2048),
    topP: Schema.number().default(1.0)
  })
})

class OpenAIProvider implements IModelProvider {
  readonly instanceName: string
  readonly providerType = 'openai'
  readonly models: ModelInfo[]
  private client: ReturnType<typeof createOpenAI>

  constructor(config: Config) {
    this.instanceName = config.instanceName
    this.client = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })
    this.models = config.models.map(m => ({
      id: m.id,
      capabilities: m.capabilities.map(c => {
        const map: Record<string, ModelCapability> = {
          toolCalling: ModelCapability.ToolCalling,
          vision: ModelCapability.Vision,
          jsonMode: ModelCapability.JsonMode,
          streaming: ModelCapability.Streaming
        }
        return map[c] || c as ModelCapability
      }),
      defaultParams: config.defaultParams
    }))
  }

  getModel(modelId: string) {
    return this.client(modelId)
  }

  getDefaultParams(modelId: string): ModelDefaultParams {
    return this.models.find(m => m.id === modelId)?.defaultParams || {}
  }
}

export function apply(ctx: Context, config: Config) {
  const provider = new OpenAIProvider(config)
  ctx['model-service'].registerProvider(config.instanceName, provider)
  ctx.logger('provider-openai').info(`Registered OpenAI provider: ${config.instanceName}`)

  ctx.on('dispose', () => {
    ctx['model-service'].unregisterProvider(config.instanceName)
  })
}
