[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ModelSwitcher

# Class: ModelSwitcher\<T\>

Defined in: [packages/core/src/services/model/model-service.ts:396](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/model/model-service.ts#L396)

## Extended by

- [`ChatModelSwitcher`](ChatModelSwitcher.md)

## Type Parameters

### T

`T` *extends* [`BaseModel`](BaseModel.md)

## Constructors

### Constructor

> **new ModelSwitcher**\<`T`\>(`ctx`, `groupConfig`, `modelGetter`): `ModelSwitcher`\<`T`\>

Defined in: [packages/core/src/services/model/model-service.ts:401](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/model/model-service.ts#L401)

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

Defined in: [packages/core/src/services/model/model-service.ts:397](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/model/model-service.ts#L397)

***

### \_models

> `protected` `readonly` **\_models**: `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:398](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/model/model-service.ts#L398)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/model-service.ts:402](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/model/model-service.ts#L402)

***

### groupConfig

> `protected` `readonly` **groupConfig**: `object`

Defined in: [packages/core/src/services/model/model-service.ts:403](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/model/model-service.ts#L403)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

## Methods

### getCircuitBreakers()

> `protected` **getCircuitBreakers**(): `Map`\<`string`, `CircuitBreaker`\>

Defined in: [packages/core/src/services/model/model-service.ts:435](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/model/model-service.ts#L435)

#### Returns

`Map`\<`string`, `CircuitBreaker`\>

***

### getModels()

> **getModels**(): readonly `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:431](https://github.com/YesWeAreBot/YesImBot/blob/215bf0ff2d6077bafe8eaba9c8d77ae9c419a409/packages/core/src/services/model/model-service.ts#L431)

#### Returns

readonly `T`[]
