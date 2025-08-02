[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ModelServiceConfig

# Interface: ModelServiceConfig

Defined in: [packages/core/src/services/model/config.ts:185](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/config.ts#L185)

## Properties

### modelGroups

> **modelGroups**: `object`[]

Defined in: [packages/core/src/services/model/config.ts:187](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/config.ts#L187)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

#### strategy

> **strategy**: [`ModelSwitchingStrategy`](../enumerations/ModelSwitchingStrategy.md)

***

### providers

> **providers**: [`ProviderConfig`](ProviderConfig.md)[]

Defined in: [packages/core/src/services/model/config.ts:186](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/config.ts#L186)

***

### system?

> `readonly` `optional` **system**: `SystemConfig`

Defined in: [packages/core/src/services/model/config.ts:193](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/config.ts#L193)

***

### task

> **task**: `object`

Defined in: [packages/core/src/services/model/config.ts:188](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/config.ts#L188)

#### chat

> **chat**: `string`

#### embed

> **embed**: `string`

#### summarize

> **summarize**: `string`
