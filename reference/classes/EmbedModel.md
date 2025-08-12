[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / EmbedModel

# Class: EmbedModel

Defined in: [packages/core/src/services/model/embed-model.ts:14](https://github.com/YesWeAreBot/YesImBot/blob/cbfe250eb0d39492ea93b906d0ea601b2c3d6da6/packages/core/src/services/model/embed-model.ts#L14)

所有模型类的基类，封装了通用属性和方法。

## Extends

- [`BaseModel`](BaseModel.md)

## Implements

- [`IEmbedModel`](../interfaces/IEmbedModel.md)

## Constructors

### Constructor

> **new EmbedModel**(`ctx`, `embedProvider`, `modelConfig`, `fetch`): `EmbedModel`

Defined in: [packages/core/src/services/model/embed-model.ts:15](https://github.com/YesWeAreBot/YesImBot/blob/cbfe250eb0d39492ea93b906d0ea601b2c3d6da6/packages/core/src/services/model/embed-model.ts#L15)

#### Parameters

##### ctx

`Context`

##### embedProvider

(`model`) => `CommonRequestOptions`

##### modelConfig

[`ModelConfig`](../interfaces/ModelConfig.md)

##### fetch

\{(`input`, `init?`): `Promise`\<`Response`\>; (`input`, `init?`): `Promise`\<`Response`\>; \}

#### Returns

`EmbedModel`

#### Overrides

[`BaseModel`](BaseModel.md).[`constructor`](BaseModel.md#constructor)

## Properties

### config

> `readonly` **config**: [`ModelConfig`](../interfaces/ModelConfig.md)

Defined in: [packages/core/src/services/model/base-model.ts:10](https://github.com/YesWeAreBot/YesImBot/blob/cbfe250eb0d39492ea93b906d0ea601b2c3d6da6/packages/core/src/services/model/base-model.ts#L10)

#### Implementation of

[`IEmbedModel`](../interfaces/IEmbedModel.md).[`config`](../interfaces/IEmbedModel.md#config)

#### Inherited from

[`BaseModel`](BaseModel.md).[`config`](BaseModel.md#config)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/base-model.ts:12](https://github.com/YesWeAreBot/YesImBot/blob/cbfe250eb0d39492ea93b906d0ea601b2c3d6da6/packages/core/src/services/model/base-model.ts#L12)

#### Implementation of

[`IEmbedModel`](../interfaces/IEmbedModel.md).[`ctx`](../interfaces/IEmbedModel.md#ctx)

#### Inherited from

[`BaseModel`](BaseModel.md).[`ctx`](BaseModel.md#ctx)

***

### id

> `readonly` **id**: `string`

Defined in: [packages/core/src/services/model/base-model.ts:9](https://github.com/YesWeAreBot/YesImBot/blob/cbfe250eb0d39492ea93b906d0ea601b2c3d6da6/packages/core/src/services/model/base-model.ts#L9)

#### Implementation of

[`IEmbedModel`](../interfaces/IEmbedModel.md).[`id`](../interfaces/IEmbedModel.md#id)

#### Inherited from

[`BaseModel`](BaseModel.md).[`id`](BaseModel.md#id)

***

### logger

> `protected` `readonly` **logger**: `__module`

Defined in: [packages/core/src/services/model/base-model.ts:11](https://github.com/YesWeAreBot/YesImBot/blob/cbfe250eb0d39492ea93b906d0ea601b2c3d6da6/packages/core/src/services/model/base-model.ts#L11)

#### Implementation of

[`IEmbedModel`](../interfaces/IEmbedModel.md).[`logger`](../interfaces/IEmbedModel.md#logger)

#### Inherited from

[`BaseModel`](BaseModel.md).[`logger`](BaseModel.md#logger)

## Methods

### embed()

> **embed**(`text`): `Promise`\<`EmbedResult`\>

Defined in: [packages/core/src/services/model/embed-model.ts:24](https://github.com/YesWeAreBot/YesImBot/blob/cbfe250eb0d39492ea93b906d0ea601b2c3d6da6/packages/core/src/services/model/embed-model.ts#L24)

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`EmbedResult`\>

#### Implementation of

[`IEmbedModel`](../interfaces/IEmbedModel.md).[`embed`](../interfaces/IEmbedModel.md#embed)

***

### embedMany()

> **embedMany**(`texts`): `Promise`\<`EmbedManyResult`\>

Defined in: [packages/core/src/services/model/embed-model.ts:34](https://github.com/YesWeAreBot/YesImBot/blob/cbfe250eb0d39492ea93b906d0ea601b2c3d6da6/packages/core/src/services/model/embed-model.ts#L34)

#### Parameters

##### texts

`string`[]

#### Returns

`Promise`\<`EmbedManyResult`\>

#### Implementation of

[`IEmbedModel`](../interfaces/IEmbedModel.md).[`embedMany`](../interfaces/IEmbedModel.md#embedmany)
