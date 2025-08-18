[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ChatModelSwitcher

# Class: ChatModelSwitcher

Defined in: [packages/core/src/services/model/model-service.ts:497](https://github.com/YesWeAreBot/YesImBot/blob/c58e5d7dbfcd35236ce8121d18475f7c24321d07/packages/core/src/services/model/model-service.ts#L497)

## Extends

- [`ModelSwitcher`](ModelSwitcher.md)\<[`IChatModel`](../interfaces/IChatModel.md)\>

## Constructors

### Constructor

> **new ChatModelSwitcher**(`ctx`, `groupConfig`, `modelGetter`): `ChatModelSwitcher`

Defined in: [packages/core/src/services/model/model-service.ts:501](https://github.com/YesWeAreBot/YesImBot/blob/c58e5d7dbfcd35236ce8121d18475f7c24321d07/packages/core/src/services/model/model-service.ts#L501)

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

Defined in: [packages/core/src/services/model/model-service.ts:451](https://github.com/YesWeAreBot/YesImBot/blob/c58e5d7dbfcd35236ce8121d18475f7c24321d07/packages/core/src/services/model/model-service.ts#L451)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`_logger`](ModelSwitcher.md#_logger)

***

### \_models

> `protected` `readonly` **\_models**: [`IChatModel`](../interfaces/IChatModel.md)[]

Defined in: [packages/core/src/services/model/model-service.ts:452](https://github.com/YesWeAreBot/YesImBot/blob/c58e5d7dbfcd35236ce8121d18475f7c24321d07/packages/core/src/services/model/model-service.ts#L452)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`_models`](ModelSwitcher.md#_models)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/model-service.ts:456](https://github.com/YesWeAreBot/YesImBot/blob/c58e5d7dbfcd35236ce8121d18475f7c24321d07/packages/core/src/services/model/model-service.ts#L456)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`ctx`](ModelSwitcher.md#ctx)

***

### groupConfig

> `protected` `readonly` **groupConfig**: `object`

Defined in: [packages/core/src/services/model/model-service.ts:457](https://github.com/YesWeAreBot/YesImBot/blob/c58e5d7dbfcd35236ce8121d18475f7c24321d07/packages/core/src/services/model/model-service.ts#L457)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`groupConfig`](ModelSwitcher.md#groupconfig)

## Methods

### chat()

> **chat**(`options`): `Promise`\<`GenerateTextResult`\>

Defined in: [packages/core/src/services/model/model-service.ts:518](https://github.com/YesWeAreBot/YesImBot/blob/c58e5d7dbfcd35236ce8121d18475f7c24321d07/packages/core/src/services/model/model-service.ts#L518)

#### Parameters

##### options

[`ChatRequestOptions`](../interfaces/ChatRequestOptions.md)

#### Returns

`Promise`\<`GenerateTextResult`\>

***

### getCircuitBreakers()

> `protected` **getCircuitBreakers**(): `Map`\<`string`, `CircuitBreaker`\>

Defined in: [packages/core/src/services/model/model-service.ts:490](https://github.com/YesWeAreBot/YesImBot/blob/c58e5d7dbfcd35236ce8121d18475f7c24321d07/packages/core/src/services/model/model-service.ts#L490)

#### Returns

`Map`\<`string`, `CircuitBreaker`\>

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`getCircuitBreakers`](ModelSwitcher.md#getcircuitbreakers)

***

### getModels()

> **getModels**(): readonly [`IChatModel`](../interfaces/IChatModel.md)[]

Defined in: [packages/core/src/services/model/model-service.ts:486](https://github.com/YesWeAreBot/YesImBot/blob/c58e5d7dbfcd35236ce8121d18475f7c24321d07/packages/core/src/services/model/model-service.ts#L486)

#### Returns

readonly [`IChatModel`](../interfaces/IChatModel.md)[]

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`getModels`](ModelSwitcher.md#getmodels)

***

### hasVisionCapability()

> **hasVisionCapability**(): `boolean`

Defined in: [packages/core/src/services/model/model-service.ts:514](https://github.com/YesWeAreBot/YesImBot/blob/c58e5d7dbfcd35236ce8121d18475f7c24321d07/packages/core/src/services/model/model-service.ts#L514)

#### Returns

`boolean`
