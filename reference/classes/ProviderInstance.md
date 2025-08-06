[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ProviderInstance

# Class: ProviderInstance

Defined in: [packages/core/src/services/model/provider-instance.ts:11](https://github.com/YesWeAreBot/YesImBot/blob/87cfeb5f8b93039f15562b853c8990fff3f4fe23/packages/core/src/services/model/provider-instance.ts#L11)

## Constructors

### Constructor

> **new ProviderInstance**(`ctx`, `config`, `client`): `ProviderInstance`

Defined in: [packages/core/src/services/model/provider-instance.ts:16](https://github.com/YesWeAreBot/YesImBot/blob/87cfeb5f8b93039f15562b853c8990fff3f4fe23/packages/core/src/services/model/provider-instance.ts#L16)

#### Parameters

##### ctx

`Context`

##### config

[`ProviderConfig`](../interfaces/ProviderConfig.md)

##### client

[`IProviderClient`](../interfaces/IProviderClient.md)

#### Returns

`ProviderInstance`

## Properties

### config

> `readonly` **config**: [`ProviderConfig`](../interfaces/ProviderConfig.md)

Defined in: [packages/core/src/services/model/provider-instance.ts:18](https://github.com/YesWeAreBot/YesImBot/blob/87cfeb5f8b93039f15562b853c8990fff3f4fe23/packages/core/src/services/model/provider-instance.ts#L18)

***

### name

> `readonly` **name**: `string`

Defined in: [packages/core/src/services/model/provider-instance.ts:12](https://github.com/YesWeAreBot/YesImBot/blob/87cfeb5f8b93039f15562b853c8990fff3f4fe23/packages/core/src/services/model/provider-instance.ts#L12)

## Methods

### getChatModel()

> **getChatModel**(`modelId`): [`IChatModel`](../interfaces/IChatModel.md)

Defined in: [packages/core/src/services/model/provider-instance.ts:70](https://github.com/YesWeAreBot/YesImBot/blob/87cfeb5f8b93039f15562b853c8990fff3f4fe23/packages/core/src/services/model/provider-instance.ts#L70)

#### Parameters

##### modelId

`string`

#### Returns

[`IChatModel`](../interfaces/IChatModel.md)

***

### getEmbedModel()

> **getEmbedModel**(`modelId`): [`IEmbedModel`](../interfaces/IEmbedModel.md)

Defined in: [packages/core/src/services/model/provider-instance.ts:74](https://github.com/YesWeAreBot/YesImBot/blob/87cfeb5f8b93039f15562b853c8990fff3f4fe23/packages/core/src/services/model/provider-instance.ts#L74)

#### Parameters

##### modelId

`string`

#### Returns

[`IEmbedModel`](../interfaces/IEmbedModel.md)
