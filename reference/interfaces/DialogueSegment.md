[**koishi-plugin-yesimbot**](../README.md)

***

[koishi-plugin-yesimbot](../packages.md) / DialogueSegment

# Interface: DialogueSegment

Defined in: [packages/core/src/services/worldstate/types.ts:201](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/worldstate/types.ts#L201)

用户对话片段，聚合了一段时间内的相关消息和系统事件

## Extended by

- [`PendingDialogueSegment`](PendingDialogueSegment.md)
- [`ClosedDialogueSegment`](ClosedDialogueSegment.md)
- [`FoldedDialogueSegment`](FoldedDialogueSegment.md)
- [`SummarizedDialogueSegment`](SummarizedDialogueSegment.md)

## Properties

### channelId

> **channelId**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:205](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/worldstate/types.ts#L205)

***

### guildId?

> `optional` **guildId**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:206](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/worldstate/types.ts#L206)

***

### id

> **id**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:203](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/worldstate/types.ts#L203)

***

### platform

> **platform**: `string`

Defined in: [packages/core/src/services/worldstate/types.ts:204](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/worldstate/types.ts#L204)

***

### startTimestamp

> **startTimestamp**: `Date`

Defined in: [packages/core/src/services/worldstate/types.ts:216](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/worldstate/types.ts#L216)

***

### status

> **status**: [`DialogueSegmentStatus`](../type-aliases/DialogueSegmentStatus.md)

Defined in: [packages/core/src/services/worldstate/types.ts:215](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/worldstate/types.ts#L215)

片段的生命周期状态
- `open`: 开放中，正在接收新事件
- `closed`: 已关闭，通常在 Agent 介入时发生，等待系统进一步处理
- `folded`: 已折叠，其关联的 AgentTurn 因历史过长被从上下文中移除
- `summarized`: 已总结，原始内容已被LLM压缩成摘要
- `archived`: 已归档，记录在被物理删除前的最终状态，不参与上下文构建

***

### type

> **type**: `"dialogue-segment"`

Defined in: [packages/core/src/services/worldstate/types.ts:202](https://github.com/YesWeAreBot/YesImBot/blob/3acef27bf0908a52f344fc7c792c2548c86c96e2/packages/core/src/services/worldstate/types.ts#L202)
