[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / ClosedDialogueSegment

# Interface: ClosedDialogueSegment

Defined in: [packages/core/src/services/worldstate/types.ts:225](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/worldstate/types.ts#L225)

用户对话片段，聚合了一段时间内的相关消息和系统事件

## Extends

- [`DialogueSegment`](DialogueSegment.md)

## Properties

### agentTurn

> **agentTurn**: [`AgentTurn`](AgentTurn.md)

Defined in: [packages/core/src/services/worldstate/types.ts:229](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/worldstate/types.ts#L229)

***

### channelId

> **channelId**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:205](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/worldstate/types.ts#L205)

#### Inherited from

[`DialogueSegment`](DialogueSegment.md).[`channelId`](DialogueSegment.md#channelid)

***

### dialogue

> **dialogue**: [`ContextualMessage`](ContextualMessage.md)[]

Defined in: [packages/core/src/services/worldstate/types.ts:227](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/worldstate/types.ts#L227)

***

### endTimestamp

> **endTimestamp**: `Date`

Defined in: [packages/core/src/services/worldstate/types.ts:230](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/worldstate/types.ts#L230)

***

### guildId?

> `optional` **guildId**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:206](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/worldstate/types.ts#L206)

#### Inherited from

[`DialogueSegment`](DialogueSegment.md).[`guildId`](DialogueSegment.md#guildid)

***

### id

> **id**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:203](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/worldstate/types.ts#L203)

#### Inherited from

[`DialogueSegment`](DialogueSegment.md).[`id`](DialogueSegment.md#id)

***

### platform

> **platform**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:204](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/worldstate/types.ts#L204)

#### Inherited from

[`DialogueSegment`](DialogueSegment.md).[`platform`](DialogueSegment.md#platform)

***

### startTimestamp

> **startTimestamp**: `Date`

Defined in: [packages/core/src/services/worldstate/types.ts:216](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/worldstate/types.ts#L216)

#### Inherited from

[`DialogueSegment`](DialogueSegment.md).[`startTimestamp`](DialogueSegment.md#starttimestamp)

***

### status

> **status**: `"closed"`

Defined in: [packages/core/src/services/worldstate/types.ts:226](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/worldstate/types.ts#L226)

片段的生命周期状态
- `open`: 开放中，正在接收新事件
- `closed`: 已关闭，通常在 Agent 介入时发生，等待系统进一步处理
- `folded`: 已折叠，其关联的 AgentTurn 因历史过长被从上下文中移除
- `summarized`: 已总结，原始内容已被LLM压缩成摘要
- `archived`: 已归档，记录在被物理删除前的最终状态，不参与上下文构建

#### Overrides

[`DialogueSegment`](DialogueSegment.md).[`status`](DialogueSegment.md#status)

***

### systemEvents

> **systemEvents**: [`SystemEvent`](../type-aliases/SystemEvent.md)[]

Defined in: [packages/core/src/services/worldstate/types.ts:228](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/worldstate/types.ts#L228)

***

### type

> **type**: `"dialogue-segment"`

Defined in: [packages/core/src/services/worldstate/types.ts:202](https://github.com/YesWeAreBot/YesImBot/blob/dfa0f43b5c34b9e1bd33ab6df2bf8b09eb335d1a/packages/core/src/services/worldstate/types.ts#L202)

#### Inherited from

[`DialogueSegment`](DialogueSegment.md).[`type`](DialogueSegment.md#type)
