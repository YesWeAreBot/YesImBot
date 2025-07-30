[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / AssetService

# Class: AssetService

Defined in: [packages/core/src/services/assets/service.ts:22](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/assets/service.ts#L22)

## Extends

- `Service`\<[`AssetServiceConfig`](../interfaces/AssetServiceConfig.md)\>

## Constructors

### Constructor

> **new AssetService**(`ctx`, `config`): `AssetService`

Defined in: [packages/core/src/services/assets/service.ts:26](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/assets/service.ts#L26)

#### Parameters

##### ctx

`Context`

##### config

[`AssetServiceConfig`](../interfaces/AssetServiceConfig.md)

#### Returns

`AssetService`

#### Overrides

`Service<AssetServiceConfig>.constructor`

## Properties

### config

> **config**: [`AssetServiceConfig`](../interfaces/AssetServiceConfig.md)

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

> `readonly` `static` **inject**: `string`[]

Defined in: [packages/core/src/services/assets/service.ts:23](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/assets/service.ts#L23)

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

### create()

> **create**(`source`, `type`, `metadata`): `Promise`\<`string`\>

Defined in: [packages/core/src/services/assets/service.ts:146](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/assets/service.ts#L146)

创建一个新资源.
此方法会处理不同来源 (Buffer, data:, file:, http(s):) 的资源,
进行大小校验、哈希查重、文件存储和数据库记录, 最终返回资源的唯一ID.

#### Parameters

##### source

资源的来源, 可以是 Buffer, data URL, file URL 或 http/https URL.

`string` | `Buffer`\<`ArrayBufferLike`\>

##### type

[`AssetType`](../enumerations/AssetType.md)

资源的类型.

##### metadata

[`AssetMetadata`](../interfaces/AssetMetadata.md) = `{}`

资源的元数据.

#### Returns

`Promise`\<`string`\>

资源的唯一 ID.

***

### encode()

> **encode**(`source`): `Promise`\<`Element`[]\>

Defined in: [packages/core/src/services/assets/service.ts:111](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/assets/service.ts#L111)

将消息中带有内部 ID 的资源元素转换为平台可发送的 URL 格式.

#### Parameters

##### source

待编码的消息字符串或元素数组

`string` | `Element`[]

#### Returns

`Promise`\<`Element`[]\>

编码后的消息元素数组

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

### getAssetDataWithContent()

> **getAssetDataWithContent**(`id`): `Promise`\<\{ `content`: `string`; `data`: [`AssetData`](../interfaces/AssetData.md); \}\>

Defined in: [packages/core/src/services/assets/service.ts:288](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/assets/service.ts#L288)

获取资源的 Base64 编码内容（兼容 ImageService 接口）

#### Parameters

##### id

`string`

资源 ID

#### Returns

`Promise`\<\{ `content`: `string`; `data`: [`AssetData`](../interfaces/AssetData.md); \}\>

包含资源数据和 Base64 内容的对象

***

### getImageLocalPath()

> **getImageLocalPath**(`id`): `Promise`\<`string`\>

Defined in: [packages/core/src/services/assets/service.ts:311](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/assets/service.ts#L311)

兼容 ImageService 的 getImageLocalPath 方法

#### Parameters

##### id

`string`

资源 ID

#### Returns

`Promise`\<`string`\>

资源的本地存储路径

***

### getInfo()

> **getInfo**(`id`): `Promise`\<[`AssetInfo`](../interfaces/AssetInfo.md)\>

Defined in: [packages/core/src/services/assets/service.ts:251](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/assets/service.ts#L251)

根据 ID 获取资源的元信息.

#### Parameters

##### id

`string`

资源 ID

#### Returns

`Promise`\<[`AssetInfo`](../interfaces/AssetInfo.md)\>

资源的元信息.

***

### getPublicUrl()

> **getPublicUrl**(`id`): `Promise`\<`string`\>

Defined in: [packages/core/src/services/assets/service.ts:267](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/assets/service.ts#L267)

获取资源的公开访问链接.
如果配置了 endpoint, 则返回基于 endpoint 的 URL.
否则, 返回 Base64 编码的 Data URL.

#### Parameters

##### id

`string`

资源 ID

#### Returns

`Promise`\<`string`\>

资源的公开链接

***

### read()

> **read**(`id`): `Promise`\<`Buffer`\<`ArrayBufferLike`\>\>

Defined in: [packages/core/src/services/assets/service.ts:237](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/assets/service.ts#L237)

根据 ID 读取资源的二进制内容.

#### Parameters

##### id

`string`

资源 ID

#### Returns

`Promise`\<`Buffer`\<`ArrayBufferLike`\>\>

资源的 Buffer.

***

### start()

> `protected` **start**(): `Promise`\<`void`\>

Defined in: [packages/core/src/services/assets/service.ts:32](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/assets/service.ts#L32)

#### Returns

`Promise`\<`void`\>

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

### transform()

> **transform**(`source`): `Promise`\<`string`\>

Defined in: [packages/core/src/services/assets/service.ts:61](https://github.com/YesWeAreBot/YesImBot/blob/c9126b8ecca4a32cc724d3c58cbe1e003093cd79/packages/core/src/services/assets/service.ts#L61)

#### Parameters

##### source

`string`

#### Returns

`Promise`\<`string`\>

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
