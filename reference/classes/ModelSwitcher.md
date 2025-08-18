[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ModelSwitcher

# Class: ModelSwitcher\<T\>

Defined in: [packages/core/src/services/model/model-service.ts:450](https://github.com/YesWeAreBot/YesImBot/blob/fb14bed7712a478f5f9f5f32b360615cb2070423/packages/core/src/services/model/model-service.ts#L450)

## Extended by

- [`ChatModelSwitcher`](ChatModelSwitcher.md)

## Type Parameters

### T

`T` *extends* [`BaseModel`](BaseModel.md)

## Constructors

### Constructor

> **new ModelSwitcher**\<`T`\>(`ctx`, `groupConfig`, `modelGetter`): `ModelSwitcher`\<`T`\>

Defined in: [packages/core/src/services/model/model-service.ts:455](https://github.com/YesWeAreBot/YesImBot/blob/fb14bed7712a478f5f9f5f32b360615cb2070423/packages/core/src/services/model/model-service.ts#L455)

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

Defined in: [packages/core/src/services/model/model-service.ts:451](https://github.com/YesWeAreBot/YesImBot/blob/fb14bed7712a478f5f9f5f32b360615cb2070423/packages/core/src/services/model/model-service.ts#L451)

***

### \_models

> `protected` `readonly` **\_models**: `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:452](https://github.com/YesWeAreBot/YesImBot/blob/fb14bed7712a478f5f9f5f32b360615cb2070423/packages/core/src/services/model/model-service.ts#L452)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/model-service.ts:456](https://github.com/YesWeAreBot/YesImBot/blob/fb14bed7712a478f5f9f5f32b360615cb2070423/packages/core/src/services/model/model-service.ts#L456)

***

### groupConfig

> `protected` `readonly` **groupConfig**: `object`

Defined in: [packages/core/src/services/model/model-service.ts:457](https://github.com/YesWeAreBot/YesImBot/blob/fb14bed7712a478f5f9f5f32b360615cb2070423/packages/core/src/services/model/model-service.ts#L457)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

## Methods

### getCircuitBreakers()

> `protected` **getCircuitBreakers**(): `Map`\<`string`, `CircuitBreaker`\>

Defined in: [packages/core/src/services/model/model-service.ts:490](https://github.com/YesWeAreBot/YesImBot/blob/fb14bed7712a478f5f9f5f32b360615cb2070423/packages/core/src/services/model/model-service.ts#L490)

#### Returns

`Map`\<`string`, `CircuitBreaker`\>

***

### getModels()

> **getModels**(): readonly `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:486](https://github.com/YesWeAreBot/YesImBot/blob/fb14bed7712a478f5f9f5f32b360615cb2070423/packages/core/src/services/model/model-service.ts#L486)

#### Returns

readonly `T`[]
