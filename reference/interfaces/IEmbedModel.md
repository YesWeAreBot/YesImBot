[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / IEmbedModel

# Interface: IEmbedModel

Defined in: [packages/core/src/services/model/embed-model.ts:9](https://github.com/YesWeAreBot/YesImBot/blob/d81a9a66524cf3cbf62c7f9a48801dbb459c0b9c/packages/core/src/services/model/embed-model.ts#L9)

所有模型类的基类，封装了通用属性和方法。

## Extends

- [`BaseModel`](../classes/BaseModel.md)

## Properties

### config

> `readonly` **config**: [`ModelConfig`](ModelConfig.md)

Defined in: [packages/core/src/services/model/base-model.ts:10](https://github.com/YesWeAreBot/YesImBot/blob/d81a9a66524cf3cbf62c7f9a48801dbb459c0b9c/packages/core/src/services/model/base-model.ts#L10)

#### Inherited from

[`BaseModel`](../classes/BaseModel.md).[`config`](../classes/BaseModel.md#config)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/base-model.ts:12](https://github.com/YesWeAreBot/YesImBot/blob/d81a9a66524cf3cbf62c7f9a48801dbb459c0b9c/packages/core/src/services/model/base-model.ts#L12)

#### Inherited from

[`BaseModel`](../classes/BaseModel.md).[`ctx`](../classes/BaseModel.md#ctx)

***

### id

> `readonly` **id**: `string`

Defined in: [packages/core/src/services/model/base-model.ts:9](https://github.com/YesWeAreBot/YesImBot/blob/d81a9a66524cf3cbf62c7f9a48801dbb459c0b9c/packages/core/src/services/model/base-model.ts#L9)

#### Inherited from

[`BaseModel`](../classes/BaseModel.md).[`id`](../classes/BaseModel.md#id)

***

### logger

> `protected` `readonly` **logger**: `__module`

Defined in: [packages/core/src/services/model/base-model.ts:11](https://github.com/YesWeAreBot/YesImBot/blob/d81a9a66524cf3cbf62c7f9a48801dbb459c0b9c/packages/core/src/services/model/base-model.ts#L11)

#### Inherited from

[`BaseModel`](../classes/BaseModel.md).[`logger`](../classes/BaseModel.md#logger)

## Methods

### embed()

> **embed**(`text`): `Promise`\<`EmbedResult`\>

Defined in: [packages/core/src/services/model/embed-model.ts:10](https://github.com/YesWeAreBot/YesImBot/blob/d81a9a66524cf3cbf62c7f9a48801dbb459c0b9c/packages/core/src/services/model/embed-model.ts#L10)

#### Parameters

##### text

`string`

#### Returns

`Promise`\<`EmbedResult`\>

***

### embedMany()

> **embedMany**(`texts`): `Promise`\<`EmbedManyResult`\>

Defined in: [packages/core/src/services/model/embed-model.ts:11](https://github.com/YesWeAreBot/YesImBot/blob/d81a9a66524cf3cbf62c7f9a48801dbb459c0b9c/packages/core/src/services/model/embed-model.ts#L11)

#### Parameters

##### texts

`string`[]

#### Returns

`Promise`\<`EmbedManyResult`\>
