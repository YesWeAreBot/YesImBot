[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / MemoryService

# Class: MemoryService

Defined in: [packages/core/src/services/memory/MemoryService.ts:15](https://github.com/YesWeAreBot/YesImBot/blob/f812fe748c45734fc4145f4d7c773df313d9885a/packages/core/src/services/memory/MemoryService.ts#L15)

## Extends

- `Service`\<[`MemoryConfig`](../interfaces/MemoryConfig.md)\>

## Constructors

### Constructor

> **new MemoryService**(`ctx`, `config`): `MemoryService`

Defined in: [packages/core/src/services/memory/MemoryService.ts:20](https://github.com/YesWeAreBot/YesImBot/blob/f812fe748c45734fc4145f4d7c773df313d9885a/packages/core/src/services/memory/MemoryService.ts#L20)

#### Parameters

##### ctx

`Context`

##### config

[`MemoryConfig`](../interfaces/MemoryConfig.md)

#### Returns

`MemoryService`

#### Overrides

`Service<MemoryConfig>.constructor`

## Properties

### config

> **config**: [`MemoryConfig`](../interfaces/MemoryConfig.md)

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

`Service.logger`

***

### name

> **name**: `string`

Defined in: node\_modules/@cordisjs/core/lib/index.d.ts:13

#### Inherited from

`Service.name`

***

### schema

> **schema**: `SchemaService`

Defined in: node\_modules/cordis/lib/index.d.ts:20

#### Inherited from

`Service.schema`

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

Defined in: [packages/core/src/services/memory/MemoryService.ts:16](https://github.com/YesWeAreBot/YesImBot/blob/f812fe748c45734fc4145f4d7c773df313d9885a/packages/core/src/services/memory/MemoryService.ts#L16)

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

### getMemoryBlocksForRendering()

> **getMemoryBlocksForRendering**(): [`MemoryBlockData`](../interfaces/MemoryBlockData.md)[]

Defined in: [packages/core/src/services/memory/MemoryService.ts:30](https://github.com/YesWeAreBot/YesImBot/blob/f812fe748c45734fc4145f4d7c773df313d9885a/packages/core/src/services/memory/MemoryService.ts#L30)

#### Returns

[`MemoryBlockData`](../interfaces/MemoryBlockData.md)[]

***

### loadCoreMemoryBlocks()

> **loadCoreMemoryBlocks**(): `Promise`\<`void`\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:37](https://github.com/YesWeAreBot/YesImBot/blob/f812fe748c45734fc4145f4d7c773df313d9885a/packages/core/src/services/memory/MemoryService.ts#L37)

扫描核心记忆目录，加载所有可用的记忆块

#### Returns

`Promise`\<`void`\>

***

### start()

> `protected` **start**(): `void`

Defined in: [packages/core/src/services/memory/MemoryService.ts:26](https://github.com/YesWeAreBot/YesImBot/blob/f812fe748c45734fc4145f4d7c773df313d9885a/packages/core/src/services/memory/MemoryService.ts#L26)

#### Returns

`void`

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
