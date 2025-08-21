[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ProviderInstance

# Class: ProviderInstance

Defined in: [packages/core/src/services/model/provider-instance.ts:11](https://github.com/YesWeAreBot/YesImBot/blob/f812fe748c45734fc4145f4d7c773df313d9885a/packages/core/src/services/model/provider-instance.ts#L11)

## Constructors

### Constructor

> **new ProviderInstance**(`ctx`, `config`, `client`): `ProviderInstance`

Defined in: [packages/core/src/services/model/provider-instance.ts:16](https://github.com/YesWeAreBot/YesImBot/blob/f812fe748c45734fc4145f4d7c773df313d9885a/packages/core/src/services/model/provider-instance.ts#L16)

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

Defined in: [packages/core/src/services/model/provider-instance.ts:18](https://github.com/YesWeAreBot/YesImBot/blob/f812fe748c45734fc4145f4d7c773df313d9885a/packages/core/src/services/model/provider-instance.ts#L18)

***

### name

> `readonly` **name**: `string`

Defined in: [packages/core/src/services/model/provider-instance.ts:12](https://github.com/YesWeAreBot/YesImBot/blob/f812fe748c45734fc4145f4d7c773df313d9885a/packages/core/src/services/model/provider-instance.ts#L12)

## Methods

### getChatModel()

> **getChatModel**(`modelId`): [`IChatModel`](../interfaces/IChatModel.md)

Defined in: [packages/core/src/services/model/provider-instance.ts:69](https://github.com/YesWeAreBot/YesImBot/blob/f812fe748c45734fc4145f4d7c773df313d9885a/packages/core/src/services/model/provider-instance.ts#L69)

#### Parameters

##### modelId

`string`

#### Returns

[`IChatModel`](../interfaces/IChatModel.md)

***

### getEmbedModel()

> **getEmbedModel**(`modelId`): [`IEmbedModel`](../interfaces/IEmbedModel.md)

Defined in: [packages/core/src/services/model/provider-instance.ts:73](https://github.com/YesWeAreBot/YesImBot/blob/f812fe748c45734fc4145f4d7c773df313d9885a/packages/core/src/services/model/provider-instance.ts#L73)

#### Parameters

##### modelId

`string`

#### Returns

[`IEmbedModel`](../interfaces/IEmbedModel.md)
