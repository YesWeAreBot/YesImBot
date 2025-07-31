[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / MemoryConfig

# Interface: MemoryConfig

Defined in: [packages/core/src/services/memory/config.ts:5](https://github.com/YesWeAreBot/YesImBot/blob/f40a2c3f35bb44bbd9f41261b4cceea534e7e968/packages/core/src/services/memory/config.ts#L5)

记忆服务配置

## Properties

### coreMemoryPath

> **coreMemoryPath**: `string`

Defined in: [packages/core/src/services/memory/config.ts:6](https://github.com/YesWeAreBot/YesImBot/blob/f40a2c3f35bb44bbd9f41261b4cceea534e7e968/packages/core/src/services/memory/config.ts#L6)

***

### errorHandling

> **errorHandling**: `object`

Defined in: [packages/core/src/services/memory/config.ts:36](https://github.com/YesWeAreBot/YesImBot/blob/f40a2c3f35bb44bbd9f41261b4cceea534e7e968/packages/core/src/services/memory/config.ts#L36)

错误处理和重试设置

#### circuitBreakerResetMs

> **circuitBreakerResetMs**: `number`

熔断器重置时间（毫秒）

#### circuitBreakerThreshold

> **circuitBreakerThreshold**: `number`

熔断器失败阈值

#### lockTimeoutMs

> **lockTimeoutMs**: `number`

操作锁超时时间（毫秒）

#### maxRetries

> **maxRetries**: `number`

最大重试次数

#### retryDelayMs

> **retryDelayMs**: `number`

重试延迟（毫秒）

***

### forgetting

> **forgetting**: `object`

Defined in: [packages/core/src/services/memory/config.ts:8](https://github.com/YesWeAreBot/YesImBot/blob/f40a2c3f35bb44bbd9f41261b4cceea534e7e968/packages/core/src/services/memory/config.ts#L8)

记忆衰减设置

#### accessCountThreshold

> **accessCountThreshold**: `number`

遗忘阈值：低于此访问次数的事实才可能被遗忘

#### checkIntervalHours

> **checkIntervalHours**: `number`

触发遗忘检查的周期（小时）

#### salienceThreshold

> **salienceThreshold**: `number`

遗忘阈值：低于此显著性的事实才可能被遗忘

#### stalenessDays

> **stalenessDays**: `number`

遗忘阈值：多久未访问的事实可被视为陈旧（天）

***

### profileGeneration

> **profileGeneration**: `object`

Defined in: [packages/core/src/services/memory/config.ts:19](https://github.com/YesWeAreBot/YesImBot/blob/f40a2c3f35bb44bbd9f41261b4cceea534e7e968/packages/core/src/services/memory/config.ts#L19)

用户画像生成设置

#### confidenceThreshold

> **confidenceThreshold**: `number`

置信度阈值：低于此值的画像更新将被拒绝

#### enableIncrementalUpdate

> **enableIncrementalUpdate**: `boolean`

是否启用增量更新：只处理新增的事实而不是全部重新生成

#### factRelevanceThreshold

> **factRelevanceThreshold**: `number`

事实相关性阈值：低于此值的事实不参与画像生成

#### keyFactWeight

> **keyFactWeight**: `number`

关键事实权重：标记为关键的事实在画像生成中的权重倍数

#### maxSummaryLength

> **maxSummaryLength**: `number`

总结字数限制：生成的用户画像最大字符数

#### minFactsForUpdate

> **minFactsForUpdate**: `number`

最小事实数量：至少需要多少条新事实才触发画像更新

#### updateIntervalHours

> **updateIntervalHours**: `number`

画像更新频率控制：最少间隔多少小时才能更新同一用户的画像
