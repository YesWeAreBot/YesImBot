[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / IChatModel

# Interface: IChatModel

Defined in: [packages/core/src/services/model/chat-model.ts:51](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/model/chat-model.ts#L51)

所有模型类的基类，封装了通用属性和方法。

## Extends

- [`BaseModel`](../classes/BaseModel.md)

## Properties

### config

> `readonly` **config**: [`ModelConfig`](ModelConfig.md)

Defined in: [packages/core/src/services/model/base-model.ts:10](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/model/base-model.ts#L10)

#### Inherited from

[`BaseModel`](../classes/BaseModel.md).[`config`](../classes/BaseModel.md#config)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/base-model.ts:12](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/model/base-model.ts#L12)

#### Inherited from

[`BaseModel`](../classes/BaseModel.md).[`ctx`](../classes/BaseModel.md#ctx)

***

### id

> `readonly` **id**: `string`

Defined in: [packages/core/src/services/model/base-model.ts:9](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/model/base-model.ts#L9)

#### Inherited from

[`BaseModel`](../classes/BaseModel.md).[`id`](../classes/BaseModel.md#id)

***

### logger

> `protected` `readonly` **logger**: `__module`

Defined in: [packages/core/src/services/model/base-model.ts:11](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/model/base-model.ts#L11)

#### Inherited from

[`BaseModel`](../classes/BaseModel.md).[`logger`](../classes/BaseModel.md#logger)

## Methods

### chat()

> **chat**(`options`, `abortSignal?`): `Promise`\<`GenerateTextResult`\>

Defined in: [packages/core/src/services/model/chat-model.ts:52](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/model/chat-model.ts#L52)

#### Parameters

##### options

[`ChatRequestOptions`](ChatRequestOptions.md)

##### abortSignal?

`AbortSignal`

#### Returns

`Promise`\<`GenerateTextResult`\>

***

### isVisionModel()

> **isVisionModel**(): `boolean`

Defined in: [packages/core/src/services/model/chat-model.ts:53](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/model/chat-model.ts#L53)

#### Returns

`boolean`
