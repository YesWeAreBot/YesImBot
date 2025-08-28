[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ChatModelSwitcher

# Class: ChatModelSwitcher

Defined in: [packages/core/src/services/model/model-service.ts:493](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/model/model-service.ts#L493)

## Extends

- [`ModelSwitcher`](ModelSwitcher.md)\<[`IChatModel`](../interfaces/IChatModel.md)\>

## Constructors

### Constructor

> **new ChatModelSwitcher**(`ctx`, `groupConfig`, `modelGetter`): `ChatModelSwitcher`

Defined in: [packages/core/src/services/model/model-service.ts:497](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/model/model-service.ts#L497)

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

Defined in: [packages/core/src/services/model/model-service.ts:447](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/model/model-service.ts#L447)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`_logger`](ModelSwitcher.md#_logger)

***

### \_models

> `protected` `readonly` **\_models**: [`IChatModel`](../interfaces/IChatModel.md)[]

Defined in: [packages/core/src/services/model/model-service.ts:448](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/model/model-service.ts#L448)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`_models`](ModelSwitcher.md#_models)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/model-service.ts:452](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/model/model-service.ts#L452)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`ctx`](ModelSwitcher.md#ctx)

***

### groupConfig

> `protected` `readonly` **groupConfig**: `object`

Defined in: [packages/core/src/services/model/model-service.ts:453](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/model/model-service.ts#L453)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`groupConfig`](ModelSwitcher.md#groupconfig)

## Methods

### chat()

> **chat**(`options`): `Promise`\<`GenerateTextResult`\>

Defined in: [packages/core/src/services/model/model-service.ts:514](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/model/model-service.ts#L514)

#### Parameters

##### options

[`ChatRequestOptions`](../interfaces/ChatRequestOptions.md)

#### Returns

`Promise`\<`GenerateTextResult`\>

***

### getCircuitBreakers()

> `protected` **getCircuitBreakers**(): `Map`\<`string`, `CircuitBreaker`\>

Defined in: [packages/core/src/services/model/model-service.ts:486](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/model/model-service.ts#L486)

#### Returns

`Map`\<`string`, `CircuitBreaker`\>

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`getCircuitBreakers`](ModelSwitcher.md#getcircuitbreakers)

***

### getModels()

> **getModels**(): readonly [`IChatModel`](../interfaces/IChatModel.md)[]

Defined in: [packages/core/src/services/model/model-service.ts:482](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/model/model-service.ts#L482)

#### Returns

readonly [`IChatModel`](../interfaces/IChatModel.md)[]

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`getModels`](ModelSwitcher.md#getmodels)

***

### hasVisionCapability()

> **hasVisionCapability**(): `boolean`

Defined in: [packages/core/src/services/model/model-service.ts:510](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/model/model-service.ts#L510)

#### Returns

`boolean`
