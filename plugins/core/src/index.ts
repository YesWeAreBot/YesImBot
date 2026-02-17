import { Context, Schema } from 'koishi'

export const name = 'yesimbot-core'

export const inject = []

export interface Config {}

export const Config: Schema<Config> = Schema.object({})

export function apply(ctx: Context, config: Config) {
  ctx.on('ready', () => {
    ctx.logger('yesimbot-core').info('YesImBot core plugin initialized')
  })

  ctx.on('dispose', () => {
    ctx.logger('yesimbot-core').info('YesImBot core plugin disposed')
  })
}
