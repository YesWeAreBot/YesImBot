[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ProviderInstance

# Class: ProviderInstance

Defined in: [packages/core/src/services/model/provider-instance.ts:11](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/provider-instance.ts#L11)

## Constructors

### Constructor

> **new ProviderInstance**(`ctx`, `config`, `client`): `ProviderInstance`

Defined in: [packages/core/src/services/model/provider-instance.ts:16](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/provider-instance.ts#L16)

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

Defined in: [packages/core/src/services/model/provider-instance.ts:16](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/provider-instance.ts#L16)

***

### name

> `readonly` **name**: `string`

Defined in: [packages/core/src/services/model/provider-instance.ts:12](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/provider-instance.ts#L12)

## Methods

### getChatModel()

> **getChatModel**(`modelId`): [`IChatModel`](../interfaces/IChatModel.md)

Defined in: [packages/core/src/services/model/provider-instance.ts:64](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/provider-instance.ts#L64)

#### Parameters

##### modelId

`string`

#### Returns

[`IChatModel`](../interfaces/IChatModel.md)

***

### getEmbedModel()

> **getEmbedModel**(`modelId`): [`IEmbedModel`](../interfaces/IEmbedModel.md)

Defined in: [packages/core/src/services/model/provider-instance.ts:68](https://github.com/YesWeAreBot/YesImBot/blob/9f92331ebfc2b4dcfa92d459f1cf500505226bc6/packages/core/src/services/model/provider-instance.ts#L68)

#### Parameters

##### modelId

`string`

#### Returns

[`IEmbedModel`](../interfaces/IEmbedModel.md)
