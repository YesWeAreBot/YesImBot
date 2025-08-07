[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ModelSwitcher

# Class: ModelSwitcher\<T\>

Defined in: [packages/core/src/services/model/model-service.ts:409](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/model/model-service.ts#L409)

## Extended by

- [`ChatModelSwitcher`](ChatModelSwitcher.md)

## Type Parameters

### T

`T` *extends* [`BaseModel`](BaseModel.md)

## Constructors

### Constructor

> **new ModelSwitcher**\<`T`\>(`ctx`, `groupConfig`, `modelGetter`): `ModelSwitcher`\<`T`\>

Defined in: [packages/core/src/services/model/model-service.ts:414](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/model/model-service.ts#L414)

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

Defined in: [packages/core/src/services/model/model-service.ts:410](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/model/model-service.ts#L410)

***

### \_models

> `protected` `readonly` **\_models**: `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:411](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/model/model-service.ts#L411)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/model-service.ts:415](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/model/model-service.ts#L415)

***

### groupConfig

> `protected` `readonly` **groupConfig**: `object`

Defined in: [packages/core/src/services/model/model-service.ts:416](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/model/model-service.ts#L416)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

## Methods

### getCircuitBreakers()

> `protected` **getCircuitBreakers**(): `Map`\<`string`, `CircuitBreaker`\>

Defined in: [packages/core/src/services/model/model-service.ts:449](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/model/model-service.ts#L449)

#### Returns

`Map`\<`string`, `CircuitBreaker`\>

***

### getModels()

> **getModels**(): readonly `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:445](https://github.com/YesWeAreBot/YesImBot/blob/0406fd67880597b4fffddeb19651df15b210fb4d/packages/core/src/services/model/model-service.ts#L445)

#### Returns

readonly `T`[]
