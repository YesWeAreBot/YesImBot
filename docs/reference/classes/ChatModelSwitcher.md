[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ChatModelSwitcher

# Class: ChatModelSwitcher

Defined in: [packages/core/src/services/model/model-service.ts:424](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/model/model-service.ts#L424)

## Extends

- [`ModelSwitcher`](ModelSwitcher.md)\<[`IChatModel`](../interfaces/IChatModel.md)\>

## Constructors

### Constructor

> **new ChatModelSwitcher**(`ctx`, `groupConfig`, `modelGetter`): `ChatModelSwitcher`

Defined in: [packages/core/src/services/model/model-service.ts:428](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/model/model-service.ts#L428)

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

Defined in: [packages/core/src/services/model/model-service.ts:376](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/model/model-service.ts#L376)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`_logger`](ModelSwitcher.md#_logger)

***

### \_models

> `protected` `readonly` **\_models**: [`IChatModel`](../interfaces/IChatModel.md)[]

Defined in: [packages/core/src/services/model/model-service.ts:377](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/model/model-service.ts#L377)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`_models`](ModelSwitcher.md#_models)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/model-service.ts:381](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/model/model-service.ts#L381)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`ctx`](ModelSwitcher.md#ctx)

***

### groupConfig

> `protected` `readonly` **groupConfig**: `object`

Defined in: [packages/core/src/services/model/model-service.ts:382](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/model/model-service.ts#L382)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`groupConfig`](ModelSwitcher.md#groupconfig)

## Methods

### chat()

> **chat**(`options`): `Promise`\<`GenerateTextResult`\>

Defined in: [packages/core/src/services/model/model-service.ts:445](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/model/model-service.ts#L445)

#### Parameters

##### options

[`ChatRequestOptions`](../interfaces/ChatRequestOptions.md)

#### Returns

`Promise`\<`GenerateTextResult`\>

***

### getCircuitBreakers()

> `protected` **getCircuitBreakers**(): `Map`\<`string`, `CircuitBreaker`\>

Defined in: [packages/core/src/services/model/model-service.ts:417](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/model/model-service.ts#L417)

#### Returns

`Map`\<`string`, `CircuitBreaker`\>

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`getCircuitBreakers`](ModelSwitcher.md#getcircuitbreakers)

***

### getModels()

> **getModels**(): readonly [`IChatModel`](../interfaces/IChatModel.md)[]

Defined in: [packages/core/src/services/model/model-service.ts:413](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/model/model-service.ts#L413)

#### Returns

readonly [`IChatModel`](../interfaces/IChatModel.md)[]

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`getModels`](ModelSwitcher.md#getmodels)

***

### hasVisionCapability()

> **hasVisionCapability**(): `boolean`

Defined in: [packages/core/src/services/model/model-service.ts:441](https://github.com/YesWeAreBot/YesImBot/blob/7ef28a691ce81d31b3075d68b83f6c934b67bb24/packages/core/src/services/model/model-service.ts#L441)

#### Returns

`boolean`
