[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / MemoryService

# Class: MemoryService

Defined in: [packages/core/src/services/memory/MemoryService.ts:43](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L43)

## Extends

- `Service`\<[`MemoryConfig`](../interfaces/MemoryConfig.md)\>

## Constructors

### Constructor

> **new MemoryService**(`ctx`, `config`): `MemoryService`

Defined in: [packages/core/src/services/memory/MemoryService.ts:68](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L68)

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

> `readonly` `static` **inject**: `string`[]

Defined in: [packages/core/src/services/memory/MemoryService.ts:44](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L44)

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

### addUserFact()

> **addUserFact**(`factData`): `Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`Fact`](../interfaces/Fact.md)\>\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:517](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L517)

#### Parameters

##### factData

`Omit`\<[`Fact`](../interfaces/Fact.md), `"id"` \| `"embedding"` \| `"createdAt"` \| `"lastAccessedAt"` \| `"accessCount"`\>

#### Returns

`Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`Fact`](../interfaces/Fact.md)\>\>

***

### addUserInsight()

> **addUserInsight**(`insightData`): `Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`Insight`](../interfaces/Insight.md)\>\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:624](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L624)

#### Parameters

##### insightData

`Omit`\<[`Insight`](../interfaces/Insight.md), `"id"` \| `"embedding"` \| `"createdAt"` \| `"lastAccessedAt"` \| `"accessCount"`\>

#### Returns

`Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`Insight`](../interfaces/Insight.md)\>\>

***

### consolidateProfile()

> **consolidateProfile**(`userId`, `contextId`, `options`): `Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`UserProfile`](../interfaces/UserProfile.md)\>\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:786](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L786)

#### Parameters

##### userId

`string`

##### contextId

`string`

##### options

[`ProfileConsolidationOptions`](../interfaces/ProfileConsolidationOptions.md) = `{}`

#### Returns

`Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`UserProfile`](../interfaces/UserProfile.md)\>\>

***

### decayAndForget()

> **decayAndForget**(): `Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<\{ `removedCount`: `number`; \}\>\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:799](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L799)

#### Returns

`Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<\{ `removedCount`: `number`; \}\>\>

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

> **getMemoryBlocksForRendering**(): `Promise`\<[`MemoryBlockData`](../interfaces/MemoryBlockData.md)[]\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:385](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L385)

#### Returns

`Promise`\<[`MemoryBlockData`](../interfaces/MemoryBlockData.md)[]\>

***

### getUserFacts()

> **getUserFacts**(`userId`, `options`): `Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`Fact`](../interfaces/Fact.md)[]\>\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:589](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L589)

#### Parameters

##### userId

`string`

##### options

[`SearchOptions`](../interfaces/SearchOptions.md) = `{}`

#### Returns

`Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`Fact`](../interfaces/Fact.md)[]\>\>

***

### getUserInsights()

> **getUserInsights**(`userId`, `options`): `Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`Insight`](../interfaces/Insight.md)[]\>\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:689](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L689)

#### Parameters

##### userId

`string`

##### options

[`SearchOptions`](../interfaces/SearchOptions.md) = `{}`

#### Returns

`Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`Insight`](../interfaces/Insight.md)[]\>\>

***

### getUserProfile()

> **getUserProfile**(`userId`, `contextId`): `Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`UserProfile`](../interfaces/UserProfile.md)\>\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:726](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L726)

#### Parameters

##### userId

`string`

##### contextId

`string`

#### Returns

`Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`UserProfile`](../interfaces/UserProfile.md)\>\>

***

### search()

> **search**(`type`, `query`, `options`): `Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<([`Fact`](../interfaces/Fact.md) \| [`Insight`](../interfaces/Insight.md))[]\>\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:401](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L401)

在内存中对指定类型的实体（'insights' 或 'facts'）进行语义搜索

#### Parameters

##### type

要搜索的实体类型

`"insights"` | `"facts"`

##### query

`string`

搜索查询字符串

##### options

[`SearchOptions`](../interfaces/SearchOptions.md) = `{}`

搜索选项

#### Returns

`Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<([`Fact`](../interfaces/Fact.md) \| [`Insight`](../interfaces/Insight.md))[]\>\>

包含相似度分数的实体列表

***

### searchMemories()

> **searchMemories**(`query`, `options`): `Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`MemorySearchResult`](../type-aliases/MemorySearchResult.md)[]\>\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:447](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L447)

使用单个查询嵌入，同时在用户事实（Facts）和洞察（Insights）中进行语义搜索
返回一个按相似度统一排序的混合结果列表

#### Parameters

##### query

`string`

搜索查询字符串

##### options

[`SearchOptions`](../interfaces/SearchOptions.md) = `{}`

搜索选项，如 limit, minSimilarity 等

#### Returns

`Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`MemorySearchResult`](../type-aliases/MemorySearchResult.md)[]\>\>

一个包含事实和洞察的、按相似度排序的列表

***

### searchUserFacts()

> **searchUserFacts**(`query`, `options`): `Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`Fact`](../interfaces/Fact.md)[]\>\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:538](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L538)

#### Parameters

##### query

`string`

##### options

[`SearchOptions`](../interfaces/SearchOptions.md) = `{}`

#### Returns

`Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`Fact`](../interfaces/Fact.md)[]\>\>

***

### searchUserInsights()

> **searchUserInsights**(`query`, `options`): `Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`Insight`](../interfaces/Insight.md)[]\>\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:645](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L645)

#### Parameters

##### query

`string`

##### options

[`SearchOptions`](../interfaces/SearchOptions.md) = `{}`

#### Returns

`Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`Insight`](../interfaces/Insight.md)[]\>\>

***

### searchUserProfiles()

> **searchUserProfiles**(`query`, `options`): `Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`UserProfile`](../interfaces/UserProfile.md)[]\>\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:741](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L741)

#### Parameters

##### query

`string`

##### options

[`SearchOptions`](../interfaces/SearchOptions.md) = `{}`

#### Returns

`Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<[`UserProfile`](../interfaces/UserProfile.md)[]\>\>

***

### start()

> `protected` **start**(): `Promise`\<`void`\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:112](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L112)

#### Returns

`Promise`\<`void`\>

#### Overrides

`Service.start`

***

### stop()

> `protected` **stop**(): `Promise`\<`void`\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:123](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L123)

#### Returns

`Promise`\<`void`\>

#### Overrides

`Service.stop`

***

### updateFactAccess()

> **updateFactAccess**(`factId`): `Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<`void`\>\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:601](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L601)

#### Parameters

##### factId

`string`

#### Returns

`Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<`void`\>\>

***

### updateInsightAccess()

> **updateInsightAccess**(`insightId`): `Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<`void`\>\>

Defined in: [packages/core/src/services/memory/MemoryService.ts:704](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/memory/MemoryService.ts#L704)

#### Parameters

##### insightId

`string`

#### Returns

`Promise`\<[`MemoryOperationResult`](../interfaces/MemoryOperationResult.md)\<`void`\>\>

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
