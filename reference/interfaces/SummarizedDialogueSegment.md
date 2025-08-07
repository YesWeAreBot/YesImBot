[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / SummarizedDialogueSegment

# Interface: SummarizedDialogueSegment

Defined in: [packages/core/src/services/worldstate/types.ts:247](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L247)

状态为 `summarized` 的对话片段，包含一个总结文本，不包含详细对话内容
通常是一个 `folded` 片段总结而来

## Extends

- [`DialogueSegment`](DialogueSegment.md)

## Properties

### channelId

> **channelId**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:205](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L205)

#### Inherited from

[`DialogueSegment`](DialogueSegment.md).[`channelId`](DialogueSegment.md#channelid)

***

### endTimestamp

> **endTimestamp**: `Date`

Defined in: [packages/core/src/services/worldstate/types.ts:250](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L250)

***

### guildId?

> `optional` **guildId**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:206](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L206)

#### Inherited from

[`DialogueSegment`](DialogueSegment.md).[`guildId`](DialogueSegment.md#guildid)

***

### id

> **id**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:203](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L203)

#### Inherited from

[`DialogueSegment`](DialogueSegment.md).[`id`](DialogueSegment.md#id)

***

### platform

> **platform**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:204](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L204)

#### Inherited from

[`DialogueSegment`](DialogueSegment.md).[`platform`](DialogueSegment.md#platform)

***

### startTimestamp

> **startTimestamp**: `Date`

Defined in: [packages/core/src/services/worldstate/types.ts:216](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L216)

#### Inherited from

[`DialogueSegment`](DialogueSegment.md).[`startTimestamp`](DialogueSegment.md#starttimestamp)

***

### status

> **status**: `"summarized"`

Defined in: [packages/core/src/services/worldstate/types.ts:248](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L248)

片段的生命周期状态
- `open`: 开放中，正在接收新事件
- `closed`: 已关闭，通常在 Agent 介入时发生，等待系统进一步处理
- `folded`: 已折叠，其关联的 AgentTurn 因历史过长被从上下文中移除
- `summarized`: 已总结，原始内容已被LLM压缩成摘要
- `archived`: 已归档，记录在被物理删除前的最终状态，不参与上下文构建

#### Overrides

[`DialogueSegment`](DialogueSegment.md).[`status`](DialogueSegment.md#status)

***

### summary

> **summary**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:249](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L249)

***

### type

> **type**: `"dialogue-segment"`

Defined in: [packages/core/src/services/worldstate/types.ts:202](https://github.com/YesWeAreBot/YesImBot/blob/a26b18d5f86d4c4e605876da40856dbd27bd5323/packages/core/src/services/worldstate/types.ts#L202)

#### Inherited from

[`DialogueSegment`](DialogueSegment.md).[`type`](DialogueSegment.md#type)
