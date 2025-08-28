[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / WorldStateService

# Class: WorldStateService

Defined in: [packages/core/src/services/worldstate/index.ts:32](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/worldstate/index.ts#L32)

## Extends

- `Service`\<[`HistoryConfig`](../interfaces/HistoryConfig.md)\>

## Constructors

### Constructor

> **new WorldStateService**(`ctx`, `config`): `WorldStateService`

Defined in: [packages/core/src/services/worldstate/index.ts:44](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/worldstate/index.ts#L44)

#### Parameters

##### ctx

`Context`

##### config

[`HistoryConfig`](../interfaces/HistoryConfig.md)

#### Returns

`WorldStateService`

#### Overrides

`Service<HistoryConfig>.constructor`

## Properties

### config

> **config**: [`HistoryConfig`](../interfaces/HistoryConfig.md)

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

### l1\_manager

> **l1\_manager**: `InteractionManager`

Defined in: [packages/core/src/services/worldstate/index.ts:35](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/worldstate/index.ts#L35)

***

### l2\_manager

> **l2\_manager**: `SemanticMemoryManager`

Defined in: [packages/core/src/services/worldstate/index.ts:36](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/worldstate/index.ts#L36)

***

### l3\_manager

> **l3\_manager**: `ArchivalMemoryManager`

Defined in: [packages/core/src/services/worldstate/index.ts:37](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/worldstate/index.ts#L37)

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

Defined in: [packages/core/src/services/worldstate/index.ts:33](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/worldstate/index.ts#L33)

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

### buildWorldState()

> **buildWorldState**(`session`): `Promise`\<[`WorldState`](../interfaces/WorldState.md)\>

Defined in: [packages/core/src/services/worldstate/index.ts:78](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/worldstate/index.ts#L78)

#### Parameters

##### session

`Session`

#### Returns

`Promise`\<[`WorldState`](../interfaces/WorldState.md)\>

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

### isBotMuted()

> **isBotMuted**(`channelCid`): `boolean`

Defined in: [packages/core/src/services/worldstate/index.ts:104](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/worldstate/index.ts#L104)

#### Parameters

##### channelCid

`string`

#### Returns

`boolean`

***

### isChannelAllowed()

> **isChannelAllowed**(`session`): `boolean`

Defined in: [packages/core/src/services/worldstate/index.ts:89](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/worldstate/index.ts#L89)

#### Parameters

##### session

`Session`

#### Returns

`boolean`

***

### recordMessage()

> **recordMessage**(`message`): `Promise`\<`void`\>

Defined in: [packages/core/src/services/worldstate/index.ts:82](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/worldstate/index.ts#L82)

#### Parameters

##### message

[`MessageData`](../interfaces/MessageData.md)

#### Returns

`Promise`\<`void`\>

***

### recordSystemEvent()

> **recordSystemEvent**(`event`): `Promise`\<`void`\>

Defined in: [packages/core/src/services/worldstate/index.ts:100](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/worldstate/index.ts#L100)

#### Parameters

##### event

[`SystemEventData`](../interfaces/SystemEventData.md)

#### Returns

`Promise`\<`void`\>

***

### start()

> `protected` **start**(): `Promise`\<`void`\>

Defined in: [packages/core/src/services/worldstate/index.ts:58](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/worldstate/index.ts#L58)

#### Returns

`Promise`\<`void`\>

#### Overrides

`Service.start`

***

### stop()

> `protected` **stop**(): `void`

Defined in: [packages/core/src/services/worldstate/index.ts:71](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/worldstate/index.ts#L71)

#### Returns

`void`

#### Overrides

`Service.stop`

***

### updateMuteStatus()

> **updateMuteStatus**(`cid`, `expiresAt`): `void`

Defined in: [packages/core/src/services/worldstate/index.ts:116](https://github.com/YesWeAreBot/YesImBot/blob/f4d5754821350f350a6c532c9d602254fd31f385/packages/core/src/services/worldstate/index.ts#L116)

#### Parameters

##### cid

`string`

##### expiresAt

`number`

#### Returns

`void`

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
