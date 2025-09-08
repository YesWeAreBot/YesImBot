[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ChatModel

# Class: ChatModel

Defined in: [packages/core/src/services/model/chat-model.ts:61](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/chat-model.ts#L61)

ChatModel 类提供了与大语言模型进行聊天交互的核心功能
它封装了流式与非流式请求、参数合并、内容验证以及统一的错误处理逻辑

## Extends

- [`BaseModel`](BaseModel.md)

## Implements

- [`IChatModel`](../interfaces/IChatModel.md)

## Constructors

### Constructor

> **new ChatModel**(`ctx`, `chatProvider`, `modelConfig`, `fetch`): `ChatModel`

Defined in: [packages/core/src/services/model/chat-model.ts:64](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/chat-model.ts#L64)

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

Defined in: [packages/core/src/services/model/base-model.ts:10](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/base-model.ts#L10)

#### Implementation of

[`IChatModel`](../interfaces/IChatModel.md).[`config`](../interfaces/IChatModel.md#config)

#### Inherited from

[`BaseModel`](BaseModel.md).[`config`](BaseModel.md#config)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/base-model.ts:12](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/base-model.ts#L12)

#### Implementation of

[`IChatModel`](../interfaces/IChatModel.md).[`ctx`](../interfaces/IChatModel.md#ctx)

#### Inherited from

[`BaseModel`](BaseModel.md).[`ctx`](BaseModel.md#ctx)

***

### id

> `readonly` **id**: `string`

Defined in: [packages/core/src/services/model/base-model.ts:9](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/base-model.ts#L9)

#### Implementation of

[`IChatModel`](../interfaces/IChatModel.md).[`id`](../interfaces/IChatModel.md#id)

#### Inherited from

[`BaseModel`](BaseModel.md).[`id`](BaseModel.md#id)

***

### logger

> `protected` `readonly` **logger**: `__module`

Defined in: [packages/core/src/services/model/base-model.ts:11](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/base-model.ts#L11)

#### Implementation of

[`IChatModel`](../interfaces/IChatModel.md).[`logger`](../interfaces/IChatModel.md#logger)

#### Inherited from

[`BaseModel`](BaseModel.md).[`logger`](BaseModel.md#logger)

## Methods

### chat()

> **chat**(`options`): `Promise`\<`GenerateTextResult`\>

Defined in: [packages/core/src/services/model/chat-model.ts:116](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/chat-model.ts#L116)

发起聊天请求的核心方法
根据配置和运行时参数，自动选择流式或非流式处理

#### Parameters

##### options

[`ChatRequestOptions`](../interfaces/ChatRequestOptions.md)

#### Returns

`Promise`\<`GenerateTextResult`\>

#### Implementation of

[`IChatModel`](../interfaces/IChatModel.md).[`chat`](../interfaces/IChatModel.md#chat)

***

### isVisionModel()

> **isVisionModel**(): `boolean`

Defined in: [packages/core/src/services/model/chat-model.ts:74](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/chat-model.ts#L74)

#### Returns

`boolean`

#### Implementation of

[`IChatModel`](../interfaces/IChatModel.md).[`isVisionModel`](../interfaces/IChatModel.md#isvisionmodel)
