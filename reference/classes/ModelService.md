[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ModelService

# Class: ModelService

Defined in: [packages/core/src/services/model/model-service.ts:86](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/model-service.ts#L86)

## Extends

- `Service`\<[`ModelServiceConfig`](../interfaces/ModelServiceConfig.md)\>

## Constructors

### Constructor

> **new ModelService**(`ctx`, `config`): `ModelService`

Defined in: [packages/core/src/services/model/model-service.ts:91](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/model-service.ts#L91)

#### Parameters

##### ctx

`Context`

##### config

[`ModelServiceConfig`](../interfaces/ModelServiceConfig.md)

#### Returns

`ModelService`

#### Overrides

`Service<ModelServiceConfig>.constructor`

## Properties

### config

> **config**: [`ModelServiceConfig`](../interfaces/ModelServiceConfig.md)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:14

#### Inherited from

`Service.config`

***

### ctx

> `protected` **ctx**: `Context`

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:12

#### Inherited from

`Service.ctx`

***

### ~~logger~~

> **logger**: `__module`

Defined in: node\_modules/cordis/lib/index.d.ts:19

#### Deprecated

use `this.ctx.logger` instead

#### Inherited from

[`YesImBot`](YesImBot.md).[`logger`](YesImBot.md#logger)

***

### name

> **name**: `string`

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:13

#### Inherited from

[`YesImBot`](YesImBot.md).[`name`](YesImBot.md#name)

***

### schema

> **schema**: `SchemaService`

Defined in: node\_modules/cordis/lib/index.d.ts:20

#### Inherited from

[`YesImBot`](YesImBot.md).[`schema`](YesImBot.md#schema)

***

### extend

> `readonly` `static` **extend**: *typeof* [`extend`](YesImBot.md#extend)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:5

#### Inherited from

`Service.extend`

***

### immediate

> `readonly` `static` **immediate**: *typeof* [`immediate`](YesImBot.md#immediate)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:8

#### Inherited from

`Service.immediate`

***

### inject

> `readonly` `static` **inject**: [`Services`](../enumerations/Services.md)[]

Defined in: [packages/core/src/services/model/model-service.ts:87](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/model-service.ts#L87)

***

### invoke

> `readonly` `static` **invoke**: *typeof* [`invoke`](YesImBot.md#invoke)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:4

#### Inherited from

`Service.invoke`

***

### provide

> `readonly` `static` **provide**: *typeof* [`provide`](YesImBot.md#provide)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:7

#### Inherited from

`Service.provide`

***

### setup

> `readonly` `static` **setup**: *typeof* [`setup`](YesImBot.md#setup)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:3

#### Inherited from

`Service.setup`

***

### tracker

> `readonly` `static` **tracker**: *typeof* [`tracker`](YesImBot.md#tracker)

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:6

#### Inherited from

`Service.tracker`

## Methods

### \[extend\]()

> `protected` **\[extend\]**(`props?`): `any`

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:20

#### Parameters

##### props?

`any`

#### Returns

`any`

#### Inherited from

`Service.[extend]`

***

### \[filter\]()

> `protected` **\[filter\]**(`ctx`): `boolean`

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:18

#### Parameters

##### ctx

`Context`

#### Returns

`boolean`

#### Inherited from

`Service.[filter]`

***

### \[setup\]()

> **\[setup\]**(): `void`

Defined in: node\_modules/@koishijs/core/lib/index.d.ts:768

#### Returns

`void`

#### Inherited from

`Service.[setup]`

***

### fork()?

> `protected` `optional` **fork**(`ctx`, `config`): `void`

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:11

#### Parameters

##### ctx

`Context`

##### config

`any`

#### Returns

`void`

#### Inherited from

`Service.fork`

***

### getChatModel()

> **getChatModel**(`providerName`, `modelId`): [`IChatModel`](../interfaces/IChatModel.md)

Defined in: [packages/core/src/services/model/model-service.ts:134](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/model-service.ts#L134)

#### Parameters

##### providerName

`string`

##### modelId

`string`

#### Returns

[`IChatModel`](../interfaces/IChatModel.md)

***

### getEmbedModel()

> **getEmbedModel**(`providerName`, `modelId`): [`IEmbedModel`](../interfaces/IEmbedModel.md)

Defined in: [packages/core/src/services/model/model-service.ts:139](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/model-service.ts#L139)

#### Parameters

##### providerName

`string`

##### modelId

`string`

#### Returns

[`IEmbedModel`](../interfaces/IEmbedModel.md)

***

### start()

> `protected` **start**(): `void` \| `Promise`\<`void`\>

Defined in: [packages/core/src/services/model/model-service.ts:251](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/model-service.ts#L251)

#### Returns

`void` \| `Promise`\<`void`\>

#### Overrides

`Service.start`

***

### stop()

> `protected` **stop**(): `void` \| `Promise`\<`void`\>

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:10

#### Returns

`void` \| `Promise`\<`void`\>

#### Inherited from

`Service.stop`

***

### useChatGroup()

> **useChatGroup**(`name`): [`ChatModelSwitcher`](ChatModelSwitcher.md)

Defined in: [packages/core/src/services/model/model-service.ts:144](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/model-service.ts#L144)

#### Parameters

##### name

`string`

#### Returns

[`ChatModelSwitcher`](ChatModelSwitcher.md)

***

### useEmbeddingGroup()

> **useEmbeddingGroup**(`name`): [`ModelSwitcher`](ModelSwitcher.md)\<[`IEmbedModel`](../interfaces/IEmbedModel.md)\>

Defined in: [packages/core/src/services/model/model-service.ts:253](https://github.com/YesWeAreBot/YesImBot/blob/689543d3087a5e3abc4196ce8c6d95813f518274/packages/core/src/services/model/model-service.ts#L253)

#### Parameters

##### name

`string`

#### Returns

[`ModelSwitcher`](ModelSwitcher.md)\<[`IEmbedModel`](../interfaces/IEmbedModel.md)\>

***

### \[hasInstance\]()

> `static` **\[hasInstance\]**(`instance`): `boolean`

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:21

#### Parameters

##### instance

`any`

#### Returns

`boolean`

#### Inherited from

`Service.[hasInstance]`
