[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / AssetService

# Class: AssetService

Defined in: [packages/core/src/services/assets/service.ts:49](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/assets/service.ts#L49)

资源管理服务 (AssetService)
负责资源的持久化存储、去重、读取、处理和生命周期管理

## Extends

- `Service`\<[`AssetServiceConfig`](../interfaces/AssetServiceConfig.md)\>

## Constructors

### Constructor

> **new AssetService**(`ctx`, `config`): `AssetService`

Defined in: [packages/core/src/services/assets/service.ts:59](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/assets/service.ts#L59)

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

Defined in: [packages/core/src/services/assets/service.ts:50](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/assets/service.ts#L50)

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

> **create**(`source`, `metadata`, `options`): `Promise`\<`string`\>

Defined in: [packages/core/src/services/assets/service.ts:138](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/assets/service.ts#L138)

创建一个新资源。

#### Parameters

##### source

资源的来源 (Buffer, data:, file:, http(s): URL)

`string` | `Buffer`\<`ArrayBufferLike`\>

##### metadata

[`AssetMetadata`](../interfaces/AssetMetadata.md) = `{}`

资源的元数据

##### options

内部选项，如预设的ID

###### id?

`string`

#### Returns

`Promise`\<`string`\>

资源的唯一 ID

***

### encode()

> **encode**(`source`): `Promise`\<`Element`[]\>

Defined in: [packages/core/src/services/assets/service.ts:259](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/assets/service.ts#L259)

将包含内部资源ID的消息元素编码为平台可发送的URL或元素

#### Parameters

##### source

消息字符串或元素数组

`string` | `Element`[]

#### Returns

`Promise`\<`Element`[]\>

编码后的元素数组

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

### getInfo()

> **getInfo**(`id`): `Promise`\<[`AssetInfo`](../interfaces/AssetInfo.md)\>

Defined in: [packages/core/src/services/assets/service.ts:231](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/assets/service.ts#L231)

根据 ID 获取资源的元信息

#### Parameters

##### id

`string`

资源 ID

#### Returns

`Promise`\<[`AssetInfo`](../interfaces/AssetInfo.md)\>

资源的元信息，若不存在则返回 null

***

### getPublicUrl()

> **getPublicUrl**(`id`): `Promise`\<`string`\>

Defined in: [packages/core/src/services/assets/service.ts:243](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/assets/service.ts#L243)

获取资源的公开访问链接

#### Parameters

##### id

`string`

资源 ID

#### Returns

`Promise`\<`string`\>

资源的公开链接，若未配置 endpoint 则回退到 data URL

***

### read()

> **read**(`id`, `options`): `Promise`\<`string` \| `Buffer`\<`ArrayBufferLike`\>\>

Defined in: [packages/core/src/services/assets/service.ts:190](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/assets/service.ts#L190)

根据ID读取资源
支持按需进行图片处理和缓存

#### Parameters

##### id

`string`

资源 ID

##### options

[`ReadAssetOptions`](../interfaces/ReadAssetOptions.md) = `{}`

读取选项，可控制是否处理图片和返回格式

#### Returns

`Promise`\<`string` \| `Buffer`\<`ArrayBufferLike`\>\>

资源内容，格式由 options.format 决定

***

### start()

> `protected` **start**(): `Promise`\<`void`\>

Defined in: [packages/core/src/services/assets/service.ts:66](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/assets/service.ts#L66)

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

Defined in: [packages/core/src/services/assets/service.ts:111](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/assets/service.ts#L111)

同步转换消息内容，将外部资源链接持久化并替换为内部ID
此方法会等待所有资源持久化完成

#### Parameters

##### source

原始消息字符串或元素数组

`string` | `Element`[]

#### Returns

`Promise`\<`string`\>

转换后的消息字符串

***

### transformAsync()

> **transformAsync**(`source`): `Promise`\<`string`\>

Defined in: [packages/core/src/services/assets/service.ts:124](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/assets/service.ts#L124)

异步转换消息内容，立即返回带占位符ID的消息，并在后台进行资源持久化
适用于不要求立即使用资源的场景，可以提高响应速度

#### Parameters

##### source

原始消息字符串或元素数组

`string` | `Element`[]

#### Returns

`Promise`\<`string`\>

转换后的消息字符串

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
