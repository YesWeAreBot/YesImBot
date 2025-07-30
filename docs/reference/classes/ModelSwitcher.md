[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ModelSwitcher

# Class: ModelSwitcher\<T\>

Defined in: [packages/core/src/services/model/model-service.ts:208](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/model/model-service.ts#L208)

泛型模型切换器
支持代理任何继承自 BaseModel 的模型类型，并在初始化时验证其能力。

## Type Parameters

### T

`T` *extends* [`BaseModel`](BaseModel.md)

## Constructors

### Constructor

> **new ModelSwitcher**\<`T`\>(`ctx`, `modelDescriptors`, `groupName`, `modelGetter`): `ModelSwitcher`\<`T`\>

Defined in: [packages/core/src/services/model/model-service.ts:235](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/model/model-service.ts#L235)

#### Parameters

##### ctx

`Context`

##### modelDescriptors

[`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

##### groupName

`string`

##### modelGetter

(`providerName`, `modelId`) => `T`

#### Returns

`ModelSwitcher`\<`T`\>

## Accessors

### current

#### Get Signature

> **get** **current**(): `T`

Defined in: [packages/core/src/services/model/model-service.ts:217](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/model/model-service.ts#L217)

##### Returns

`T`

***

### length

#### Get Signature

> **get** **length**(): `number`

Defined in: [packages/core/src/services/model/model-service.ts:231](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/model/model-service.ts#L231)

##### Returns

`number`

***

### models

#### Get Signature

> **get** **models**(): `T`[]

Defined in: [packages/core/src/services/model/model-service.ts:213](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/model/model-service.ts#L213)

##### Returns

`T`[]

## Methods

### next()

> **next**(): `T`

Defined in: [packages/core/src/services/model/model-service.ts:221](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/model/model-service.ts#L221)

#### Returns

`T`
