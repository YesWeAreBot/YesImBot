[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ChatModelSwitcher

# Class: ChatModelSwitcher

Defined in: [packages/core/src/services/model/service.ts:484](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L484)

## Extends

- [`ModelSwitcher`](ModelSwitcher.md)\<[`IChatModel`](../interfaces/IChatModel.md)\>

## Constructors

### Constructor

> **new ChatModelSwitcher**(`ctx`, `groupConfig`, `modelGetter`): `ChatModelSwitcher`

Defined in: [packages/core/src/services/model/service.ts:488](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L488)

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

### \_models

> `protected` `readonly` **\_models**: [`IChatModel`](../interfaces/IChatModel.md)[]

Defined in: [packages/core/src/services/model/service.ts:439](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L439)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`_models`](ModelSwitcher.md#_models)

***

### ctx

> `protected` `readonly` **ctx**: `Context`

Defined in: [packages/core/src/services/model/service.ts:443](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L443)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`ctx`](ModelSwitcher.md#ctx)

***

### groupConfig

> `protected` `readonly` **groupConfig**: `object`

Defined in: [packages/core/src/services/model/service.ts:444](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L444)

#### models

> **models**: [`ModelDescriptor`](../type-aliases/ModelDescriptor.md)[]

#### name

> **name**: `string`

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`groupConfig`](ModelSwitcher.md#groupconfig)

***

### logger

> `protected` `readonly` **logger**: `__module`

Defined in: [packages/core/src/services/model/service.ts:438](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L438)

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`logger`](ModelSwitcher.md#logger)

## Methods

### chat()

> **chat**(`options`): `Promise`\<`GenerateTextResult`\>

Defined in: [packages/core/src/services/model/service.ts:505](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L505)

#### Parameters

##### options

[`ChatRequestOptions`](../interfaces/ChatRequestOptions.md)

#### Returns

`Promise`\<`GenerateTextResult`\>

***

### getCircuitBreakers()

> `protected` **getCircuitBreakers**(): `Map`\<`string`, `CircuitBreaker`\>

Defined in: [packages/core/src/services/model/service.ts:477](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L477)

#### Returns

`Map`\<`string`, `CircuitBreaker`\>

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`getCircuitBreakers`](ModelSwitcher.md#getcircuitbreakers)

***

### getModels()

> **getModels**(): readonly [`IChatModel`](../interfaces/IChatModel.md)[]

Defined in: [packages/core/src/services/model/service.ts:473](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L473)

#### Returns

readonly [`IChatModel`](../interfaces/IChatModel.md)[]

#### Inherited from

[`ModelSwitcher`](ModelSwitcher.md).[`getModels`](ModelSwitcher.md#getmodels)

***

### hasVisionCapability()

> **hasVisionCapability**(): `boolean`

Defined in: [packages/core/src/services/model/service.ts:501](https://github.com/YesWeAreBot/YesImBot/blob/925c94951232bc99112ff68ee359aa63b78c4911/packages/core/src/services/model/service.ts#L501)

#### Returns

`boolean`
