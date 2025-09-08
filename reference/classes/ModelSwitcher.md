[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ModelSwitcher

# Class: ModelSwitcher\<T\>

Defined in: [packages/core/src/services/model/service.ts:437](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L437)

## Extended by

- [`ChatModelSwitcher`](ChatModelSwitcher.md)

## Type Parameters

### T

`T` *extends* [`BaseModel`](BaseModel.md)

## Constructors

### Constructor

> **new ModelSwitcher**\<`T`\>(`ctx`, `groupConfig`, `modelGetter`): `ModelSwitcher`\<`T`\>

Defined in: [packages/core/src/services/model/service.ts:442](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L442)

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

### \_models

> `protected` `readonly` **\_models**: `T`[]

Defined in: [packages/core/src/services/model/service.ts:439](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L439)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/service.ts:443](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L443)

***

### groupConfig

> `protected` `readonly` **groupConfig**: `object`

Defined in: [packages/core/src/services/model/service.ts:444](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L444)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

***

### logger

> `protected` `readonly` **logger**: `__module`

Defined in: [packages/core/src/services/model/service.ts:438](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L438)

## Methods

### getCircuitBreakers()

> `protected` **getCircuitBreakers**(): `Map`\<`string`, `CircuitBreaker`\>

Defined in: [packages/core/src/services/model/service.ts:477](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L477)

#### Returns

`Map`\<`string`, `CircuitBreaker`\>

***

### getModels()

> **getModels**(): readonly `T`[]

Defined in: [packages/core/src/services/model/service.ts:473](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L473)

#### Returns

readonly `T`[]
