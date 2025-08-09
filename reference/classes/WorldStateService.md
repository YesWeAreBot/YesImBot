[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / WorldStateService

# Class: WorldStateService

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:33](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L33)

## Extends

- `Service`\<[`HistoryConfig`](../interfaces/HistoryConfig.md)\>

## Constructors

### Constructor

> **new WorldStateService**(`ctx`, `config`): `WorldStateService`

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:47](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L47)

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

### contextBuilder

> **contextBuilder**: `ContextBuilder`

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:37](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L37)

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

### segmentManager

> **segmentManager**: `DialogueSegmentManager`

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:38](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L38)

***

### summarizationManager

> **summarizationManager**: `SummarizationManager`

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:36](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L36)

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

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:34](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L34)

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

### buildContextForStimulus()

> **buildContextForStimulus**(`stimulus`): `Promise`\<\{ `triggerContext`: `object`; `worldState`: [`WorldState`](../interfaces/WorldState.md); \}\>

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:94](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L94)

#### Parameters

##### stimulus

[`AgentStimulus`](../interfaces/AgentStimulus.md)\<`any`\>

#### Returns

`Promise`\<\{ `triggerContext`: `object`; `worldState`: [`WorldState`](../interfaces/WorldState.md); \}\>

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

### getOpenSegment()

> **getOpenSegment**(`platform`, `channelId`, `guildId?`): `Promise`\<[`DialogueSegmentData`](../interfaces/DialogueSegmentData.md)\>

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:155](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L155)

#### Parameters

##### platform

`string`

##### channelId

`string`

##### guildId?

`string`

#### Returns

`Promise`\<[`DialogueSegmentData`](../interfaces/DialogueSegmentData.md)\>

***

### guideToSkippedTopic()

> **guideToSkippedTopic**(`channelKey`): `Promise`\<`void`\>

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:183](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L183)

引导模型关注被跳过的话题

#### Parameters

##### channelKey

`string`

频道标识符 (platform:channelId)

#### Returns

`Promise`\<`void`\>

***

### isBotMuted()

> **isBotMuted**(`channelCid`): `boolean`

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:234](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L234)

#### Parameters

##### channelCid

`string`

#### Returns

`boolean`

***

### isChannelAllowed()

> **isChannelAllowed**(`session`): `boolean`

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:256](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L256)

#### Parameters

##### session

`Session`

#### Returns

`boolean`

***

### recordAgentTurn()

> **recordAgentTurn**(`sid`, `responses`): `Promise`\<`void`\>

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:145](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L145)

#### Parameters

##### sid

`string`

##### responses

[`AgentResponse`](../interfaces/AgentResponse.md)[]

#### Returns

`Promise`\<`void`\>

***

### recordMessage()

> **recordMessage**(`segmentId`, `message`): `Promise`\<`void`\>

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:174](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L174)

#### Parameters

##### segmentId

`string`

##### message

`Omit`\<[`MessageData`](../interfaces/MessageData.md), `"sid"`\>

#### Returns

`Promise`\<`void`\>

***

### recordSystemEvent()

> **recordSystemEvent**(`session`, `payload`): `Promise`\<`void`\>

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:217](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L217)

#### Parameters

##### session

`Session`

##### payload

[`SystemEventPayload`](../interfaces/SystemEventPayload.md)

#### Returns

`Promise`\<`void`\>

***

### start()

> `protected` **start**(): `void`

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:60](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L60)

#### Returns

`void`

#### Overrides

`Service.start`

***

### stop()

> `protected` **stop**(): `void`

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:81](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L81)

#### Returns

`void`

#### Overrides

`Service.stop`

***

### updateMuteStatus()

> **updateMuteStatus**(`cid`, `expiresAt`): `void`

Defined in: [packages/core/src/services/worldstate/world-state-service.ts:246](https://github.com/YesWeAreBot/YesImBot/blob/e7184510eb1f89e870f5c71474eca385c4f7127e/packages/core/src/services/worldstate/world-state-service.ts#L246)

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
