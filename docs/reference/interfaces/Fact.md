[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / Fact

# Interface: Fact

Defined in: [packages/core/src/services/memory/types.ts:75](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L75)

记忆事实 (Fact)
记录与特定用户相关的客观事实或陈述

## Extends

- [`Searchable`](Searchable.md)

## Properties

### accessCount

> **accessCount**: `number`

Defined in: [packages/core/src/services/memory/types.ts:90](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L90)

***

### content

> **content**: `string`

Defined in: [packages/core/src/services/memory/types.ts:79](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L79)

***

### contextId

> **contextId**: `string`

Defined in: [packages/core/src/services/memory/types.ts:86](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L86)

***

### createdAt

> **createdAt**: `Date`

Defined in: [packages/core/src/services/memory/types.ts:88](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L88)

***

### embedding

> **embedding**: `number`[]

Defined in: [packages/core/src/services/memory/types.ts:80](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L80)

#### Overrides

[`Searchable`](Searchable.md).[`embedding`](Searchable.md#embedding)

***

### id

> **id**: `string`

Defined in: [packages/core/src/services/memory/types.ts:76](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L76)

***

### isDeleted?

> `optional` **isDeleted**: `boolean`

Defined in: [packages/core/src/services/memory/types.ts:93](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L93)

是否已删除（软删除）

#### Overrides

[`Searchable`](Searchable.md).[`isDeleted`](Searchable.md#isdeleted)

***

### lastAccessedAt

> **lastAccessedAt**: `Date`

Defined in: [packages/core/src/services/memory/types.ts:89](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L89)

***

### lifespan

> **lifespan**: [`LifespanType`](../enumerations/LifespanType.md)

Defined in: [packages/core/src/services/memory/types.ts:82](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L82)

***

### salience

> **salience**: `number`

Defined in: [packages/core/src/services/memory/types.ts:84](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L84)

#### Overrides

[`Searchable`](Searchable.md).[`salience`](Searchable.md#salience)

***

### sourceMessageIds

> **sourceMessageIds**: `string`[]

Defined in: [packages/core/src/services/memory/types.ts:83](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L83)

***

### type

> **type**: [`FactType`](../enumerations/FactType.md)

Defined in: [packages/core/src/services/memory/types.ts:81](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L81)

***

### updatedAt?

> `optional` **updatedAt**: `Date`

Defined in: [packages/core/src/services/memory/types.ts:95](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L95)

最后更新时间

***

### userId

> **userId**: `string`

Defined in: [packages/core/src/services/memory/types.ts:77](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L77)

***

### userName

> **userName**: `string`

Defined in: [packages/core/src/services/memory/types.ts:78](https://github.com/YesWeAreBot/YesImBot/blob/28d9c27d09ded76d0214b02d0254e49c1f0f0ecd/packages/core/src/services/memory/types.ts#L78)
