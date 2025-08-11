[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ChatModelSwitcher

# Class: ChatModelSwitcher

Defined in: [packages/core/src/services/model/model-service.ts:461](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L461)

## Extends

- [`ModelSwitcher`](ModelSwitcher.md)\<[`IChatModel`](../interfaces/IChatModel.md)\>

## Constructors

### Constructor

> **new ChatModelSwitcher**(`ctx`, `groupConfig`, `modelGetter`): `ChatModelSwitcher`

Defined in: [packages/core/src/services/model/model-service.ts:465](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L465)

#### Parameters

##### ctx

`Context`

##### groupConfig

###### models

[`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

###### name

`string`

##### modelGetter

(`providerName`, `modelId`) => [`IChatModel`](../interfaces/IChatModel.md)

#### Returns

`ChatModelSwitcher`

#### Overrides

[`ModelSwitcher`](ModelSwitcher.md).[`constructor`](ModelSwitcher.md#constructor)

## Properties

### \_logger

> `protected` `readonly` **\_logger**: `__module`

Defined in: [packages/core/src/services/model/model-service.ts:415](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L415)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`_logger`](ModelSwitcher.md#_logger)

***

### \_models

> `protected` `readonly` **\_models**: [`IChatModel`](../interfaces/IChatModel.md)[]

Defined in: [packages/core/src/services/model/model-service.ts:416](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L416)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`_models`](ModelSwitcher.md#_models)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/model-service.ts:420](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L420)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`ctx`](ModelSwitcher.md#ctx)

***

### groupConfig

> `protected` `readonly` **groupConfig**: `object`

Defined in: [packages/core/src/services/model/model-service.ts:421](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L421)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`groupConfig`](ModelSwitcher.md#groupconfig)

## Methods

### chat()

> **chat**(`options`): `Promise`\<`GenerateTextResult`\>

Defined in: [packages/core/src/services/model/model-service.ts:482](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L482)

#### Parameters

##### options

[`ChatRequestOptions`](../interfaces/ChatRequestOptions.md)

#### Returns

`Promise`\<`GenerateTextResult`\>

***

### getCircuitBreakers()

> `protected` **getCircuitBreakers**(): `Map`\<`string`, `CircuitBreaker`\>

Defined in: [packages/core/src/services/model/model-service.ts:454](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L454)

#### Returns

`Map`\<`string`, `CircuitBreaker`\>

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`getCircuitBreakers`](ModelSwitcher.md#getcircuitbreakers)

***

### getModels()

> **getModels**(): readonly [`IChatModel`](../interfaces/IChatModel.md)[]

Defined in: [packages/core/src/services/model/model-service.ts:450](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L450)

#### Returns

readonly [`IChatModel`](../interfaces/IChatModel.md)[]

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`getModels`](ModelSwitcher.md#getmodels)

***

### hasVisionCapability()

> **hasVisionCapability**(): `boolean`

Defined in: [packages/core/src/services/model/model-service.ts:478](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L478)

#### Returns

`boolean`
