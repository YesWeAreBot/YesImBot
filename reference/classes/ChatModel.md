[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ChatModel

# Class: ChatModel

Defined in: [packages/core/src/services/model/chat-model.ts:66](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/chat-model.ts#L66)

所有模型类的基类，封装了通用属性和方法。

## Extends

- [`BaseModel`](BaseModel.md)

## Implements

- [`IChatModel`](../interfaces/IChatModel.md)

## Constructors

### Constructor

> **new ChatModel**(`ctx`, `chatProvider`, `modelConfig`, `fetch`): `ChatModel`

Defined in: [packages/core/src/services/model/chat-model.ts:69](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/chat-model.ts#L69)

#### Parameters

##### ctx

`Context`

##### chatProvider

(`model`) => `CommonRequestOptions`

##### modelConfig

[`ModelConfig`](../interfaces/ModelConfig.md)

##### fetch

\{(`input`, `init?`): `Promise`\<`Response`\>; (`input`, `init?`): `Promise`\<`Response`\>; \}

#### Returns

`ChatModel`

#### Overrides

[`BaseModel`](BaseModel.md).[`constructor`](BaseModel.md#constructor)

## Properties

### config

> `readonly` **config**: [`ModelConfig`](../interfaces/ModelConfig.md)

Defined in: [packages/core/src/services/model/base-model.ts:10](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/base-model.ts#L10)

#### Implementation of

[`IChatModel`](../interfaces/IChatModel.md).[`config`](../interfaces/IChatModel.md#config)

#### Inherited from

[`BaseModel`](BaseModel.md).[`config`](BaseModel.md#config)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/base-model.ts:12](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/base-model.ts#L12)

#### Implementation of

[`IChatModel`](../interfaces/IChatModel.md).[`ctx`](../interfaces/IChatModel.md#ctx)

#### Inherited from

[`BaseModel`](BaseModel.md).[`ctx`](BaseModel.md#ctx)

***

### id

> `readonly` **id**: `string`

Defined in: [packages/core/src/services/model/base-model.ts:9](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/base-model.ts#L9)

#### Implementation of

[`IChatModel`](../interfaces/IChatModel.md).[`id`](../interfaces/IChatModel.md#id)

#### Inherited from

[`BaseModel`](BaseModel.md).[`id`](BaseModel.md#id)

***

### logger

> `protected` `readonly` **logger**: `__module`

Defined in: [packages/core/src/services/model/base-model.ts:11](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/base-model.ts#L11)

#### Implementation of

[`IChatModel`](../interfaces/IChatModel.md).[`logger`](../interfaces/IChatModel.md#logger)

#### Inherited from

[`BaseModel`](BaseModel.md).[`logger`](BaseModel.md#logger)

## Methods

### chat()

> **chat**(`options`): `Promise`\<`GenerateTextResult`\>

Defined in: [packages/core/src/services/model/chat-model.ts:115](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/chat-model.ts#L115)

发起聊天请求。

#### Parameters

##### options

[`ChatRequestOptions`](../interfaces/ChatRequestOptions.md)

包含消息和所有运行时参数的对象。

#### Returns

`Promise`\<`GenerateTextResult`\>

#### Implementation of

[`IChatModel`](../interfaces/IChatModel.md).[`chat`](../interfaces/IChatModel.md#chat)

***

### isVisionModel()

> **isVisionModel**(): `boolean`

Defined in: [packages/core/src/services/model/chat-model.ts:79](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/chat-model.ts#L79)

#### Returns

`boolean`

#### Implementation of

[`IChatModel`](../interfaces/IChatModel.md).[`isVisionModel`](../interfaces/IChatModel.md#isvisionmodel)
