[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ModelSwitcher

# Class: ModelSwitcher\<T\>

Defined in: [packages/core/src/services/model/model-service.ts:446](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/model/model-service.ts#L446)

## Extended by

- [`ChatModelSwitcher`](ChatModelSwitcher.md)

## Type Parameters

### T

`T` *extends* [`BaseModel`](BaseModel.md)

## Constructors

### Constructor

> **new ModelSwitcher**\<`T`\>(`ctx`, `groupConfig`, `modelGetter`): `ModelSwitcher`\<`T`\>

Defined in: [packages/core/src/services/model/model-service.ts:451](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/model/model-service.ts#L451)

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

Defined in: [packages/core/src/services/model/model-service.ts:447](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/model/model-service.ts#L447)

***

### \_models

> `protected` `readonly` **\_models**: `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:448](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/model/model-service.ts#L448)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/model-service.ts:452](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/model/model-service.ts#L452)

***

### groupConfig

> `protected` `readonly` **groupConfig**: `object`

Defined in: [packages/core/src/services/model/model-service.ts:453](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/model/model-service.ts#L453)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

## Methods

### getCircuitBreakers()

> `protected` **getCircuitBreakers**(): `Map`\<`string`, `CircuitBreaker`\>

Defined in: [packages/core/src/services/model/model-service.ts:486](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/model/model-service.ts#L486)

#### Returns

`Map`\<`string`, `CircuitBreaker`\>

***

### getModels()

> **getModels**(): readonly `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:482](https://github.com/YesWeAreBot/YesImBot/blob/89fa0ef148d2b85a54c30fb720197559d83768ff/packages/core/src/services/model/model-service.ts#L482)

#### Returns

readonly `T`[]
