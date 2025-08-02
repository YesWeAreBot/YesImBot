[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ChatModelSwitcher

# Class: ChatModelSwitcher

Defined in: [packages/core/src/services/model/model-service.ts:438](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L438)

## Extends

- [`ModelSwitcher`](ModelSwitcher.md)\<[`IChatModel`](../interfaces/IChatModel.md)\>

## Constructors

### Constructor

> **new ChatModelSwitcher**(`ctx`, `groupConfig`, `modelGetter`): `ChatModelSwitcher`

Defined in: [packages/core/src/services/model/model-service.ts:442](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L442)

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

Defined in: [packages/core/src/services/model/model-service.ts:393](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L393)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`_logger`](ModelSwitcher.md#_logger)

***

### \_models

> `protected` `readonly` **\_models**: [`IChatModel`](../interfaces/IChatModel.md)[]

Defined in: [packages/core/src/services/model/model-service.ts:394](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L394)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`_models`](ModelSwitcher.md#_models)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/model-service.ts:398](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L398)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`ctx`](ModelSwitcher.md#ctx)

***

### groupConfig

> `protected` `readonly` **groupConfig**: `object`

Defined in: [packages/core/src/services/model/model-service.ts:399](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L399)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`groupConfig`](ModelSwitcher.md#groupconfig)

## Methods

### chat()

> **chat**(`options`): `Promise`\<`GenerateTextResult`\>

Defined in: [packages/core/src/services/model/model-service.ts:459](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L459)

#### Parameters

##### options

[`ChatRequestOptions`](../interfaces/ChatRequestOptions.md)

#### Returns

`Promise`\<`GenerateTextResult`\>

***

### getCircuitBreakers()

> `protected` **getCircuitBreakers**(): `Map`\<`string`, `CircuitBreaker`\>

Defined in: [packages/core/src/services/model/model-service.ts:431](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L431)

#### Returns

`Map`\<`string`, `CircuitBreaker`\>

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`getCircuitBreakers`](ModelSwitcher.md#getcircuitbreakers)

***

### getModels()

> **getModels**(): readonly [`IChatModel`](../interfaces/IChatModel.md)[]

Defined in: [packages/core/src/services/model/model-service.ts:427](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L427)

#### Returns

readonly [`IChatModel`](../interfaces/IChatModel.md)[]

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`getModels`](ModelSwitcher.md#getmodels)

***

### hasVisionCapability()

> **hasVisionCapability**(): `boolean`

Defined in: [packages/core/src/services/model/model-service.ts:455](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L455)

#### Returns

`boolean`
