[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / Channel

# Interface: Channel

Defined in: [packages/core/src/services/worldstate/types.ts:120](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/worldstate/types.ts#L120)

代表一个通信频道，可以是群组中的一个子频道，也可以是私聊

## Properties

### history

> **history**: [`History`](History.md)

Defined in: [packages/core/src/services/worldstate/types.ts:140](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/worldstate/types.ts#L140)

频道的历史记录流
这是一个包含对话片段 (DialogueSegment) 的有序数组，
共同构成了 Agent 感知到的频道交互全貌

***

### id

> **id**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:122](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/worldstate/types.ts#L122)

频道ID在私聊中，这通常是与对方用户的ID关联的标识

***

### members?

> `optional` **members**: [`GuildMember`](GuildMember.md)[]

Defined in: [packages/core/src/services/worldstate/types.ts:134](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/worldstate/types.ts#L134)

最近活跃的成员列表

***

### meta

> **meta**: `object`

Defined in: [packages/core/src/services/worldstate/types.ts:130](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/worldstate/types.ts#L130)

扩展元信息

#### description?

> `optional` **description**: `string`

***

### name

> **name**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:124](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/worldstate/types.ts#L124)

频道名称群聊时为群名，私聊时可格式化为 "与 <用户名> 的私聊"

***

### platform

> **platform**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:128](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/worldstate/types.ts#L128)

所属平台名称 (如 'onebot', 'discord')

***

### type

> **type**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:126](https://github.com/YesWeAreBot/YesImBot/blob/61974070b8a0960f92d55b24b168032ee3547a7a/packages/core/src/services/worldstate/types.ts#L126)

频道类型：'guild' (群组频道) 或 'private' (私聊)
