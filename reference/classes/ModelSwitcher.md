[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ModelSwitcher

# Class: ModelSwitcher\<T\>

Defined in: [packages/core/src/services/model/model-service.ts:392](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L392)

## Extended by

- [`ChatModelSwitcher`](ChatModelSwitcher.md)

## Type Parameters

### T

`T` *extends* [`BaseModel`](BaseModel.md)

## Constructors

### Constructor

> **new ModelSwitcher**\<`T`\>(`ctx`, `groupConfig`, `modelGetter`): `ModelSwitcher`\<`T`\>

Defined in: [packages/core/src/services/model/model-service.ts:397](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L397)

#### Parameters

##### ctx

`Context`

##### groupConfig

###### models

[`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

###### name

`string`

##### modelGetter

(`providerName`, `modelId`) => `T`

#### Returns

`ModelSwitcher`\<`T`\>

## Properties

### \_logger

> `protected` `readonly` **\_logger**: `__module`

Defined in: [packages/core/src/services/model/model-service.ts:393](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L393)

***

### \_models

> `protected` `readonly` **\_models**: `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:394](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L394)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/model-service.ts:398](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L398)

***

### groupConfig

> `protected` `readonly` **groupConfig**: `object`

Defined in: [packages/core/src/services/model/model-service.ts:399](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L399)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

## Methods

### getCircuitBreakers()

> `protected` **getCircuitBreakers**(): `Map`\<`string`, `CircuitBreaker`\>

Defined in: [packages/core/src/services/model/model-service.ts:431](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L431)

#### Returns

`Map`\<`string`, `CircuitBreaker`\>

***

### getModels()

> **getModels**(): readonly `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:427](https://github.com/YesWeAreBot/YesImBot/blob/6b3381d3f0c5981890bc7b4a4f816558387d8a84/packages/core/src/services/model/model-service.ts#L427)

#### Returns

readonly `T`[]
