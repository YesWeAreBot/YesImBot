[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / BaseModel

# Abstract Class: BaseModel

Defined in: [packages/core/src/services/model/base-model.ts:8](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/model/base-model.ts#L8)

所有模型类的基类，封装了通用属性和方法。

## Extended by

- [`IChatModel`](../interfaces/IChatModel.md)
- [`ChatModel`](ChatModel.md)
- [`IEmbedModel`](../interfaces/IEmbedModel.md)
- [`EmbedModel`](EmbedModel.md)

## Constructors

### Constructor

> **new BaseModel**(`ctx`, `modelConfig`, `loggerName`): `BaseModel`

Defined in: [packages/core/src/services/model/base-model.ts:14](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/model/base-model.ts#L14)

#### Parameters

##### ctx

`Context`

##### modelConfig

[`ModelConfig`](../interfaces/ModelConfig.md)

##### loggerName

`string`

#### Returns

`BaseModel`

## Properties

### config

> `readonly` **config**: [`ModelConfig`](../interfaces/ModelConfig.md)

Defined in: [packages/core/src/services/model/base-model.ts:10](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/model/base-model.ts#L10)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/base-model.ts:12](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/model/base-model.ts#L12)

***

### id

> `readonly` **id**: `string`

Defined in: [packages/core/src/services/model/base-model.ts:9](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/model/base-model.ts#L9)

***

### logger

> `protected` `readonly` **logger**: `__module`

Defined in: [packages/core/src/services/model/base-model.ts:11](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/model/base-model.ts#L11)
