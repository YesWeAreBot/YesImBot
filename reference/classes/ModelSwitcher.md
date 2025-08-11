[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ModelSwitcher

# Class: ModelSwitcher\<T\>

Defined in: [packages/core/src/services/model/model-service.ts:414](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L414)

## Extended by

- [`ChatModelSwitcher`](ChatModelSwitcher.md)

## Type Parameters

### T

`T` *extends* [`BaseModel`](BaseModel.md)

## Constructors

### Constructor

> **new ModelSwitcher**\<`T`\>(`ctx`, `groupConfig`, `modelGetter`): `ModelSwitcher`\<`T`\>

Defined in: [packages/core/src/services/model/model-service.ts:419](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L419)

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

Defined in: [packages/core/src/services/model/model-service.ts:415](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L415)

***

### \_models

> `protected` `readonly` **\_models**: `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:416](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L416)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/model-service.ts:420](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L420)

***

### groupConfig

> `protected` `readonly` **groupConfig**: `object`

Defined in: [packages/core/src/services/model/model-service.ts:421](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L421)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

## Methods

### getCircuitBreakers()

> `protected` **getCircuitBreakers**(): `Map`\<`string`, `CircuitBreaker`\>

Defined in: [packages/core/src/services/model/model-service.ts:454](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L454)

#### Returns

`Map`\<`string`, `CircuitBreaker`\>

***

### getModels()

> **getModels**(): readonly `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:450](https://github.com/YesWeAreBot/YesImBot/blob/490e1993f165e4f32fc7f2bb413189cd6041de5c/packages/core/src/services/model/model-service.ts#L450)

#### Returns

readonly `T`[]
