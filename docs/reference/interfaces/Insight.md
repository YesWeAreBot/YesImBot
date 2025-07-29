[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / Insight

# Interface: Insight

Defined in: [packages/core/src/services/memory/types.ts:102](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/memory/types.ts#L102)

记忆洞察 (Insight)
记录从对话中提炼出的、关于群体动态或个人深层模式的更高层次判断

## Extends

- [`Searchable`](Searchable.md)

## Properties

### accessCount

> **accessCount**: `number`

Defined in: [packages/core/src/services/memory/types.ts:121](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/memory/types.ts#L121)

***

### content

> **content**: `string`

Defined in: [packages/core/src/services/memory/types.ts:106](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/memory/types.ts#L106)

***

### contextId

> **contextId**: `string`

Defined in: [packages/core/src/services/memory/types.ts:114](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/memory/types.ts#L114)

***

### createdAt

> **createdAt**: `Date`

Defined in: [packages/core/src/services/memory/types.ts:118](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/memory/types.ts#L118)

***

### embedding

> **embedding**: `number`[]

Defined in: [packages/core/src/services/memory/types.ts:107](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/memory/types.ts#L107)

#### Overrides

[`Searchable`](Searchable.md).[`embedding`](Searchable.md#embedding)

***

### id

> **id**: `string`

Defined in: [packages/core/src/services/memory/types.ts:103](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/memory/types.ts#L103)

***

### isDeleted?

> `optional` **isDeleted**: `boolean`

Defined in: [packages/core/src/services/memory/types.ts:125](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/memory/types.ts#L125)

是否已删除（软删除）

#### Overrides

[`Searchable`](Searchable.md).[`isDeleted`](Searchable.md#isdeleted)

***

### lastAccessedAt

> **lastAccessedAt**: `Date`

Defined in: [packages/core/src/services/memory/types.ts:120](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/memory/types.ts#L120)

***

### lifespan

> **lifespan**: [`LifespanType`](../enumerations/LifespanType.md)

Defined in: [packages/core/src/services/memory/types.ts:117](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/memory/types.ts#L117)

***

### relatedUserIds

> **relatedUserIds**: `string`[]

Defined in: [packages/core/src/services/memory/types.ts:111](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/memory/types.ts#L111)

***

### salience

> **salience**: `number`

Defined in: [packages/core/src/services/memory/types.ts:122](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/memory/types.ts#L122)

#### Overrides

[`Searchable`](Searchable.md).[`salience`](Searchable.md#salience)

***

### sourceMessageIds

> **sourceMessageIds**: `string`[]

Defined in: [packages/core/src/services/memory/types.ts:112](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/memory/types.ts#L112)

***

### type

> **type**: [`InsightType`](../enumerations/InsightType.md)

Defined in: [packages/core/src/services/memory/types.ts:108](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/memory/types.ts#L108)

***

### updatedAt?

> `optional` **updatedAt**: `Date`

Defined in: [packages/core/src/services/memory/types.ts:119](https://github.com/YesWeAreBot/YesImBot/blob/abd5a050f920df8554502742d8ed9e55cbaab3d3/packages/core/src/services/memory/types.ts#L119)
