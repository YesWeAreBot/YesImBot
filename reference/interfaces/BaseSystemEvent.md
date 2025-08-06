[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / BaseSystemEvent

# Interface: BaseSystemEvent\<T, P\>

Defined in: [packages/core/src/services/worldstate/types.ts:45](https://github.com/YesWeAreBot/YesImBot/blob/87cfeb5f8b93039f15562b853c8990fff3f4fe23/packages/core/src/services/worldstate/types.ts#L45)

所有非消息类系统事件的基类接口

## Type Parameters

### T

`T` *extends* [`EventName`](../type-aliases/EventName.md)

事件名称的类型

### P

`P` *extends* `object`

事件负载 (payload) 的类型

## Properties

### id

> **id**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:46](https://github.com/YesWeAreBot/YesImBot/blob/87cfeb5f8b93039f15562b853c8990fff3f4fe23/packages/core/src/services/worldstate/types.ts#L46)

***

### payload

> **payload**: `P`

Defined in: [packages/core/src/services/worldstate/types.ts:49](https://github.com/YesWeAreBot/YesImBot/blob/87cfeb5f8b93039f15562b853c8990fff3f4fe23/packages/core/src/services/worldstate/types.ts#L49)

***

### timestamp

> **timestamp**: `Date`

Defined in: [packages/core/src/services/worldstate/types.ts:48](https://github.com/YesWeAreBot/YesImBot/blob/87cfeb5f8b93039f15562b853c8990fff3f4fe23/packages/core/src/services/worldstate/types.ts#L48)

***

### type

> **type**: `T`

Defined in: [packages/core/src/services/worldstate/types.ts:47](https://github.com/YesWeAreBot/YesImBot/blob/87cfeb5f8b93039f15562b853c8990fff3f4fe23/packages/core/src/services/worldstate/types.ts#L47)
