[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ModelSwitcher

# Class: ModelSwitcher\<T\>

Defined in: [packages/core/src/services/model/model-service.ts:375](https://github.com/YesWeAreBot/YesImBot/blob/43ab446decb3ac78a2b539bbb042478596e4f630/packages/core/src/services/model/model-service.ts#L375)

## Extended by

- [`ChatModelSwitcher`](ChatModelSwitcher.md)

## Type Parameters

### T

`T` *extends* [`BaseModel`](BaseModel.md)

## Constructors

### Constructor

> **new ModelSwitcher**\<`T`\>(`ctx`, `groupConfig`, `modelGetter`): `ModelSwitcher`\<`T`\>

Defined in: [packages/core/src/services/model/model-service.ts:380](https://github.com/YesWeAreBot/YesImBot/blob/43ab446decb3ac78a2b539bbb042478596e4f630/packages/core/src/services/model/model-service.ts#L380)

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

Defined in: [packages/core/src/services/model/model-service.ts:376](https://github.com/YesWeAreBot/YesImBot/blob/43ab446decb3ac78a2b539bbb042478596e4f630/packages/core/src/services/model/model-service.ts#L376)

***

### \_models

> `protected` `readonly` **\_models**: `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:377](https://github.com/YesWeAreBot/YesImBot/blob/43ab446decb3ac78a2b539bbb042478596e4f630/packages/core/src/services/model/model-service.ts#L377)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/model-service.ts:381](https://github.com/YesWeAreBot/YesImBot/blob/43ab446decb3ac78a2b539bbb042478596e4f630/packages/core/src/services/model/model-service.ts#L381)

***

### groupConfig

> `protected` `readonly` **groupConfig**: `object`

Defined in: [packages/core/src/services/model/model-service.ts:382](https://github.com/YesWeAreBot/YesImBot/blob/43ab446decb3ac78a2b539bbb042478596e4f630/packages/core/src/services/model/model-service.ts#L382)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

## Methods

### getCircuitBreakers()

> `protected` **getCircuitBreakers**(): `Map`\<`string`, `CircuitBreaker`\>

Defined in: [packages/core/src/services/model/model-service.ts:417](https://github.com/YesWeAreBot/YesImBot/blob/43ab446decb3ac78a2b539bbb042478596e4f630/packages/core/src/services/model/model-service.ts#L417)

#### Returns

`Map`\<`string`, `CircuitBreaker`\>

***

### getModels()

> **getModels**(): readonly `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:413](https://github.com/YesWeAreBot/YesImBot/blob/43ab446decb3ac78a2b539bbb042478596e4f630/packages/core/src/services/model/model-service.ts#L413)

#### Returns

readonly `T`[]
