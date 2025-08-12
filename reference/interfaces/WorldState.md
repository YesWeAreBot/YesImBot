[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / WorldState

# Interface: WorldState

Defined in: [packages/core/src/services/worldstate/types.ts:228](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/worldstate/types.ts#L228)

Agent 感知到的世界状态快照，作为最终输入给 LLM 的上下文。

## Properties

### channel

> **channel**: `object`

Defined in: [packages/core/src/services/worldstate/types.ts:231](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/worldstate/types.ts#L231)

#### id

> **id**: `string`

#### name

> **name**: `string`

#### platform

> **platform**: `string`

#### type

> **type**: `"private"` \| `"guild"`

***

### current\_time

> **current\_time**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:237](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/worldstate/types.ts#L237)

***

### l1\_working\_memory

> **l1\_working\_memory**: `object`

Defined in: [packages/core/src/services/worldstate/types.ts:243](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/worldstate/types.ts#L243)

L1: 工作记忆，一个按时间顺序排列的线性事件流。

#### new\_events

> **new\_events**: [`L1HistoryItem`](../type-aliases/L1HistoryItem.md)[]

#### processed\_events

> **processed\_events**: [`L1HistoryItem`](../type-aliases/L1HistoryItem.md)[]

***

### l2\_retrieved\_memories?

> `optional` **l2\_retrieved\_memories**: [`RetrievedMemoryChunk`](RetrievedMemoryChunk.md)[]

Defined in: [packages/core/src/services/worldstate/types.ts:248](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/worldstate/types.ts#L248)

L2: 从海量历史中检索到的相关记忆片段

***

### l3\_diary\_entries?

> `optional` **l3\_diary\_entries**: [`DiaryEntryData`](DiaryEntryData.md)[]

Defined in: [packages/core/src/services/worldstate/types.ts:250](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/worldstate/types.ts#L250)

L3: 相关的历史日记条目

***

### self

> **self**: `object`

Defined in: [packages/core/src/services/worldstate/types.ts:238](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/worldstate/types.ts#L238)

#### id

> **id**: `string`

#### name

> **name**: `string`

***

### triggerContext?

> `optional` **triggerContext**: `object`

Defined in: [packages/core/src/services/worldstate/types.ts:230](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/worldstate/types.ts#L230)

触发本次心跳的直接原因

***

### users?

> `optional` **users**: `object`[]

Defined in: [packages/core/src/services/worldstate/types.ts:252](https://github.com/YesWeAreBot/YesImBot/blob/4c0d3adb88935dfe27979a46469bd396ba873121/packages/core/src/services/worldstate/types.ts#L252)

#### description

> **description**: `string`

#### id

> **id**: `string`

#### name

> **name**: `string`

#### roles?

> `optional` **roles**: `string`[]
