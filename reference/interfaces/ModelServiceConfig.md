[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ModelServiceConfig

# Interface: ModelServiceConfig

Defined in: [packages/core/src/services/model/config.ts:220](https://github.com/YesWeAreBot/YesImBot/blob/696f0a9ff7f5d8690e0a072a6a9bbc76d565d6ae/packages/core/src/services/model/config.ts#L220)

## Properties

### modelGroups

> **modelGroups**: `object`[]

Defined in: [packages/core/src/services/model/config.ts:222](https://github.com/YesWeAreBot/YesImBot/blob/696f0a9ff7f5d8690e0a072a6a9bbc76d565d6ae/packages/core/src/services/model/config.ts#L222)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

#### strategy

> **strategy**: [`ModelSwitchingStrategy`](../enumerations/ModelSwitchingStrategy.md)

***

### providers

> **providers**: [`ProviderConfig`](ProviderConfig.md)[]

Defined in: [packages/core/src/services/model/config.ts:221](https://github.com/YesWeAreBot/YesImBot/blob/696f0a9ff7f5d8690e0a072a6a9bbc76d565d6ae/packages/core/src/services/model/config.ts#L221)

***

### system?

> `readonly` `optional` **system**: `SystemConfig`

Defined in: [packages/core/src/services/model/config.ts:228](https://github.com/YesWeAreBot/YesImBot/blob/696f0a9ff7f5d8690e0a072a6a9bbc76d565d6ae/packages/core/src/services/model/config.ts#L228)

***

### task

> **task**: `object`

Defined in: [packages/core/src/services/model/config.ts:223](https://github.com/YesWeAreBot/YesImBot/blob/696f0a9ff7f5d8690e0a072a6a9bbc76d565d6ae/packages/core/src/services/model/config.ts#L223)

#### chat

> **chat**: `string`

#### embed

> **embed**: `string`

#### summarize

> **summarize**: `string`
