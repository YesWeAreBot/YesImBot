[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / IChatModel

# Interface: IChatModel

Defined in: [packages/core/src/services/model/chat-model.ts:36](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/model/chat-model.ts#L36)

所有模型类的基类，封装了通用属性和方法。

## Extends

- [`BaseModel`](../classes/BaseModel.md)

## Properties

### config

> `readonly` **config**: [`ModelConfig`](ModelConfig.md)

Defined in: [packages/core/src/services/model/base-model.ts:10](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/model/base-model.ts#L10)

#### Inherited from

[`BaseModel`](../classes/BaseModel.md).[`config`](../classes/BaseModel.md#config)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/base-model.ts:12](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/model/base-model.ts#L12)

#### Inherited from

[`BaseModel`](../classes/BaseModel.md).[`ctx`](../classes/BaseModel.md#ctx)

***

### id

> `readonly` **id**: `string`

Defined in: [packages/core/src/services/model/base-model.ts:9](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/model/base-model.ts#L9)

#### Inherited from

[`BaseModel`](../classes/BaseModel.md).[`id`](../classes/BaseModel.md#id)

***

### logger

> `protected` `readonly` **logger**: `__module`

Defined in: [packages/core/src/services/model/base-model.ts:11](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/model/base-model.ts#L11)

#### Inherited from

[`BaseModel`](../classes/BaseModel.md).[`logger`](../classes/BaseModel.md#logger)

## Methods

### chat()

> **chat**(`options`): `Promise`\<`GenerateTextResult`\>

Defined in: [packages/core/src/services/model/chat-model.ts:41](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/model/chat-model.ts#L41)

发起聊天请求。

#### Parameters

##### options

[`ChatRequestOptions`](ChatRequestOptions.md)

包含消息和所有运行时参数的对象。

#### Returns

`Promise`\<`GenerateTextResult`\>

***

### isVisionModel()

> **isVisionModel**(): `boolean`

Defined in: [packages/core/src/services/model/chat-model.ts:43](https://github.com/YesWeAreBot/YesImBot/blob/a16835ba7199f4e637261e869677e184b506cc48/packages/core/src/services/model/chat-model.ts#L43)

#### Returns

`boolean`
